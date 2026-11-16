/**
 * Lớp gọi API Zalo Bot.
 *
 * - Mọi lời gọi: POST https://bot-api.zaloplatforms.com/bot{TOKEN}/{method}, thân JSON tự dựng.
 * - Kiểm tra phản hồi có `ok: true`; nếu không, trả lỗi có cấu trúc (không ném ngoại lệ).
 * - Có thời gian chờ cho mỗi lời gọi (mặc định 10 giây).
 * - Token KHÔNG BAO GIỜ xuất hiện trong lỗi trả về hay nhật ký: mọi chuỗi đều qua `redact()`.
 */

export const ZALO_API_BASE = "https://bot-api.zaloplatforms.com";
export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_TEXT_LENGTH = 2000;

export type ZaloErrorCode =
  | "api_error" // Zalo trả ok: false
  | "http_error" // HTTP không 2xx và thân không có dạng { ok: false, ... }
  | "invalid_response" // thân không phải JSON hoặc thiếu trường ok
  | "timeout" // quá thời gian chờ
  | "network_error" // lỗi mạng (DNS, kết nối...)
  | "invalid_argument"; // tham số sai trước khi gọi

export interface ZaloError {
  code: ZaloErrorCode;
  /** Mô tả lỗi, đã che token. */
  description: string;
  /** Mã HTTP nếu đã nhận được phản hồi. */
  httpStatus?: number;
  /** `error_code` do Zalo trả về (nếu có). */
  zaloErrorCode?: number;
}

export type ZaloResult<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: ZaloError };

export interface ZaloClientOptions {
  token: string;
  timeoutMs?: number;
  baseUrl?: string;
  /** Cho phép thay fetch khi kiểm thử. */
  fetchImpl?: typeof fetch;
}

export interface ZaloClient {
  sendMessage(chatId: string, text: string): Promise<ZaloResult>;
  /** Viết sẵn, CHƯA dùng ở giai đoạn 1; chưa xác nhận hoạt động. */
  sendPhoto(chatId: string, photoUrl: string, caption?: string): Promise<ZaloResult>;
  setWebhook(url: string, secretToken: string): Promise<ZaloResult>;
  deleteWebhook(): Promise<ZaloResult>;
  /** Kiểm tra token hợp lệ, trả thông tin bot. Dùng để chẩn đoán. */
  getMe(): Promise<ZaloResult>;
  /** Webhook đang đăng ký (url, updated_at). Dùng để chẩn đoán. */
  getWebhookInfo(): Promise<ZaloResult>;
}

/**
 * Zalo chỉ nhận secret_token 8-256 ký tự gồm A-Z, a-z, 0-9, _ và -.
 * (Tài liệu chỉ nêu độ dài; quy tắc ký tự lấy từ thông báo lỗi thực tế của API, 16/11/2026.)
 */
export const SECRET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,256}$/;

export function isValidSecretToken(s: string | undefined | null): boolean {
  return typeof s === "string" && SECRET_TOKEN_PATTERN.test(s);
}

/** Số ký tự Unicode (code point), không phải số đơn vị UTF-16. */
export function charLength(s: string): number {
  return Array.from(s).length;
}

export function createZaloClient(options: ZaloClientOptions): ZaloClient {
  const token = options.token;
  if (!token) {
    throw new Error("Thiếu ZALO_BOT_TOKEN");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = options.baseUrl ?? ZALO_API_BASE;
  const fetchImpl = options.fetchImpl ?? fetch;

  /** Che token, các bí mật khác (và dạng mã hóa URL của chúng) trong mọi chuỗi. */
  const redact = (s: string, extraSecrets: string[] = []): string => {
    let out = s;
    for (const secret of [token, ...extraSecrets]) {
      if (!secret) continue;
      out = out.split(secret).join("***");
      const encoded = encodeURIComponent(secret);
      if (encoded !== secret) out = out.split(encoded).join("***");
    }
    return out;
  };

  const fail = (error: ZaloError, extraSecrets: string[] = []): ZaloResult => ({
    ok: false,
    error: { ...error, description: redact(error.description, extraSecrets) },
  });

  async function call(
    method: string,
    payload?: Record<string, unknown>,
    extraSecrets: string[] = [],
  ): Promise<ZaloResult> {
    const fail2 = (error: ZaloError) => fail(error, extraSecrets);
    const url = `${baseUrl}/bot${token}/${method}`;
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const e = err as { name?: string; message?: string };
      if (e?.name === "TimeoutError" || e?.name === "AbortError") {
        return fail2({ code: "timeout", description: `${method}: quá ${timeoutMs} ms` });
      }
      return fail2({
        code: "network_error",
        description: `${method}: ${e?.message ?? String(err)}`,
      });
    }

    let raw = "";
    try {
      raw = await res.text();
    } catch (err) {
      const e = err as { name?: string; message?: string };
      if (e?.name === "TimeoutError" || e?.name === "AbortError") {
        return fail2({ code: "timeout", description: `${method}: quá ${timeoutMs} ms khi đọc phản hồi` });
      }
      return fail2({ code: "network_error", description: `${method}: ${e?.message ?? String(err)}`, httpStatus: res.status });
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return fail2({
        code: res.ok ? "invalid_response" : "http_error",
        description: `${method}: HTTP ${res.status}, thân không phải JSON: ${raw.slice(0, 200)}`,
        httpStatus: res.status,
      });
    }

    const obj = (body ?? {}) as Record<string, unknown>;
    if (obj.ok === true) {
      return { ok: true, result: obj.result };
    }
    if (obj.ok === false) {
      return fail2({
        code: "api_error",
        description: `${method}: ${String(obj.description ?? obj.message ?? "không có mô tả")}`,
        httpStatus: res.status,
        zaloErrorCode: typeof obj.error_code === "number" ? obj.error_code : undefined,
      });
    }
    return fail2({
      code: res.ok ? "invalid_response" : "http_error",
      description: `${method}: HTTP ${res.status}, phản hồi thiếu trường ok: ${raw.slice(0, 200)}`,
      httpStatus: res.status,
    });
  }

  const checkText = (method: string, field: string, value: string): ZaloResult | null => {
    const n = charLength(value);
    if (n < 1 || n > MAX_TEXT_LENGTH) {
      return fail({
        code: "invalid_argument",
        description: `${method}: ${field} phải dài 1-${MAX_TEXT_LENGTH} ký tự (đang là ${n})`,
      });
    }
    return null;
  };

  return {
    async sendMessage(chatId, text) {
      if (!chatId) return fail({ code: "invalid_argument", description: "sendMessage: thiếu chat_id" });
      const bad = checkText("sendMessage", "text", text);
      if (bad) return bad;
      return call("sendMessage", { chat_id: chatId, text });
    },

    async sendPhoto(chatId, photoUrl, caption) {
      if (!chatId) return fail({ code: "invalid_argument", description: "sendPhoto: thiếu chat_id" });
      if (!photoUrl) return fail({ code: "invalid_argument", description: "sendPhoto: thiếu photo" });
      const payload: Record<string, unknown> = { chat_id: chatId, photo: photoUrl };
      if (caption !== undefined && caption !== "") {
        const bad = checkText("sendPhoto", "caption", caption);
        if (bad) return bad;
        payload.caption = caption;
      }
      return call("sendPhoto", payload);
    },

    async setWebhook(url, secretToken) {
      if (!/^https:\/\//i.test(url)) {
        return fail({ code: "invalid_argument", description: "setWebhook: url phải là HTTPS" });
      }
      if (!isValidSecretToken(secretToken)) {
        return fail({
          code: "invalid_argument",
          description:
            `setWebhook: secret_token phải dài 8-256 ký tự, chỉ gồm A-Z, a-z, 0-9, _ và - ` +
            `(đang dài ${charLength(secretToken ?? "")})`,
        });
      }
      return call("setWebhook", { url, secret_token: secretToken }, [secretToken]);
    },

    async deleteWebhook() {
      return call("deleteWebhook");
    },

    async getMe() {
      return call("getMe");
    },

    async getWebhookInfo() {
      return call("getWebhookInfo");
    },
  };
}
