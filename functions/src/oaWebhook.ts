/**
 * OA-0: webhook Zalo OA tối thiểu (docs/spec-oa-0-webhook-toi-thieu.md).
 *
 * Chỉ nhận và ghi một dòng log có cấu trúc. Không gửi tin, không gọi API Zalo,
 * không đọc/ghi Firestore, không dùng token. Mọi request đều nhận 200 {"ok":true}.
 *
 * Không phụ thuộc Firebase: khóa, logger và đồng hồ được truyền vào để kiểm thử đơn vị.
 */
import { createHash, createHmac } from "node:crypto";
import { headerValue, safeEqual } from "./security";

export type Headers = Record<string, string | string[] | undefined>;

export interface OaRequest {
  method?: string;
  headers?: Headers;
  /** Bytes gốc của body (Cloud Functions lưu trước khi parse). */
  rawBody?: Buffer;
  body?: unknown;
}

export interface OaResponse {
  status(code: number): { json(body: unknown): unknown };
}

/** Khóa ứng viên để thử chữ ký; thiếu hoặc là giá trị giữ chỗ thì bỏ qua. */
export interface OaKeys {
  oa?: string;
  app?: string;
}

export type SigVariant = "V1" | "V2" | "V3" | "V4";
export type SigResult = SigVariant | "none" | "skipped";

export interface OaDeps {
  getKeys: () => OaKeys;
  log: (entry: Record<string, unknown>) => void;
  now?: () => number;
}

export const SIGNATURE_HEADER = "x-zevent-signature";
/** Tên header có thể chứa timestamp (cho V4); chưa rõ Zalo dùng tên nào nên thử lần lượt. */
export const TIMESTAMP_HEADERS = ["x-zevent-timestamp", "x-timestamp", "timestamp"];
/** Giá trị giữ chỗ khi chưa có khóa thật (secret phải tồn tại để deploy không lỗi). */
const PLACEHOLDERS = new Set(["", "none", "-", "null", "unset"]);
const MAX_FIELD_CHARS = 100;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Chuỗi hoặc số thành chuỗi (cắt ngắn); kiểu khác thành null. */
function scalar(v: unknown): string | null {
  if (typeof v === "string") return v.slice(0, MAX_FIELD_CHARS);
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

export function hash8(id: string): string {
  return createHash("sha256").update(id, "utf8").digest("hex").slice(0, 8);
}

/** 3 ký tự đầu + 3 ký tự cuối; chuỗi ngắn thì che hết. */
export function maskId(id: string | null): string | null {
  if (id === null) return null;
  return id.length <= 6 ? "***" : `${id.slice(0, 3)}...${id.slice(-3)}`;
}

export function usableKey(k: string | undefined): string | null {
  if (typeof k !== "string") return null;
  const t = k.trim();
  return PLACEHOLDERS.has(t.toLowerCase()) ? null : t;
}

/** Lấy bytes gốc: ưu tiên rawBody, rồi body nếu là Buffer/chuỗi. Không stringify lại JSON. */
export function getRawBody(req: OaRequest): { raw: Buffer; source: "rawBody" | "body" | "none" } {
  if (Buffer.isBuffer(req.rawBody)) return { raw: req.rawBody, source: "rawBody" };
  if (Buffer.isBuffer(req.body)) return { raw: req.body, source: "body" };
  if (typeof req.body === "string") return { raw: Buffer.from(req.body, "utf8"), source: "body" };
  return { raw: Buffer.alloc(0), source: "none" };
}

const sha256Hex = (parts: Buffer[]) => createHash("sha256").update(Buffer.concat(parts)).digest("hex");
const hmacHex = (key: string, parts: Buffer[]) =>
  createHmac("sha256", key).update(Buffer.concat(parts)).digest("hex");
const b = (s: string) => Buffer.from(s, "utf8");

/**
 * Thử các biến thể chữ ký (spec mục 6) với một khóa. Trả biến thể khớp đầu tiên hoặc "none".
 * V1: so nguyên văn header; V2: bỏ tiền tố `mac=` rồi so; V3 (HMAC) và V4 (timestamp từ header)
 * so với giá trị đã bỏ tiền tố. So sánh không phân biệt hoa/thường của hex, bằng timingSafeEqual.
 */
export function trySignature(args: {
  signature: string | undefined;
  appId: string;
  raw: Buffer;
  bodyTimestamp: string;
  headerTimestamp: string | null;
  key: string | null;
}): SigResult {
  const { signature, appId, raw, bodyTimestamp, headerTimestamp, key } = args;
  if (key === null) return "skipped";
  if (!signature) return "none";
  const asIs = signature.trim().toLowerCase();
  const hasMac = asIs.startsWith("mac=");
  const stripped = hasMac ? asIs.slice(4) : asIs;

  const v1 = sha256Hex([b(appId), raw, b(bodyTimestamp), b(key)]);
  if (safeEqual(asIs, v1)) return "V1";
  if (hasMac && safeEqual(stripped, v1)) return "V2";
  const v3 = hmacHex(key, [b(appId), raw, b(bodyTimestamp)]);
  if (safeEqual(stripped, v3)) return "V3";
  if (headerTimestamp !== null) {
    const v4 = sha256Hex([b(appId), raw, b(headerTimestamp), b(key)]);
    if (safeEqual(stripped, v4)) return "V4";
  }
  return "none";
}

/** Tóm tắt header chữ ký: độ dài, 6 ký tự đầu, có tiền tố `mac=` không. Không ghi đủ chuỗi. */
export function describeSignature(sig: string | undefined): Record<string, unknown> | null {
  if (typeof sig !== "string") return null;
  return { length: sig.length, prefix6: sig.slice(0, 6), has_mac_prefix: sig.trim().toLowerCase().startsWith("mac=") };
}

/** Phân tích request thành bản ghi log (spec mục 5). Không chứa nội dung tin, ID thật, chữ ký đủ, khóa. */
export function analyzeOaRequest(req: OaRequest, keys: OaKeys): Record<string, unknown> {
  const headers: Headers = req.headers ?? {};
  const { raw, source } = getRawBody(req);

  let body: unknown;
  let parseOk = false;
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw.toString("utf8"));
      parseOk = true;
    } catch {
      parseOk = false;
    }
  } else if (isObject(req.body) && Object.keys(req.body).length > 0) {
    // Không có bytes gốc nhưng runtime đã parse: vẫn đọc trường (chữ ký sẽ không khớp).
    body = req.body;
    parseOk = true;
  }

  const obj = isObject(body) ? body : {};
  const message = isObject(obj.message) ? obj.message : {};
  const sender = isObject(obj.sender) ? obj.sender : {};
  const recipient = isObject(obj.recipient) ? obj.recipient : {};

  const eventName = scalar(obj.event_name);
  const appId = scalar(obj.app_id);
  const timestamp = scalar(obj.timestamp);
  const senderId = scalar(sender.id);
  const recipientId = scalar(recipient.id);
  const text = typeof message.text === "string" ? message.text : null;

  const attachmentTypes = Array.isArray(message.attachments)
    ? message.attachments.map((a) => (isObject(a) ? scalar(a.type) ?? "unknown" : "unknown"))
    : [];

  const isOaEcho = eventName?.startsWith("oa_send_group_") ?? false;
  const isGroup = isOaEcho || (eventName?.startsWith("user_send_group_") ?? false);

  const entry: Record<string, unknown> = {
    method: req.method ?? null,
    content_type: headerValue(headers, "content-type") ?? null,
    content_length: headerValue(headers, "content-length") ?? null,
    header_names: Object.keys(headers).map((h) => h.toLowerCase()).sort(),
    x_zevent_signature: describeSignature(headerValue(headers, SIGNATURE_HEADER)),
    num_retry: numRetry(headers),
    raw_body_source: source,
    raw_body_bytes: raw.length,
    body_parse_ok: parseOk,
    body_keys: Object.keys(obj).sort(),
    event_name: eventName,
    app_id: maskId(appId),
    timestamp,
    msg_id: scalar(message.msg_id) ?? scalar(obj.msg_id),
    sender_hash: senderId ? hash8(senderId) : null,
    recipient_hash: recipientId ? hash8(recipientId) : null,
    text_length: text === null ? null : Array.from(text).length,
    has_quote_msg_id: message.quote_msg_id !== undefined && message.quote_msg_id !== null && message.quote_msg_id !== "",
    attachment_types: attachmentTypes,
    is_group: isGroup,
    is_oa_echo: isOaEcho,
  };

  if (isGroup) {
    // Giả định cần chốt bằng log thật: recipient.id là nhóm; OA id lấy từ `oa_id`,
    // hoặc từ sender.id khi OA tự gửi vào nhóm (oa_send_group_*).
    const oaIdField = scalar(obj.oa_id);
    const oaId = oaIdField ?? (isOaEcho ? senderId : null);
    entry.group_id_hash = recipientId ? hash8(recipientId) : null;
    entry.oa_id_source = oaIdField ? "oa_id" : oaId ? "sender" : "none";
    entry.mentions_oa = text !== null && oaId !== null && text.includes(`[@${oaId}]`);
    entry.has_mention_marker = text !== null && text.includes("[@");
  }

  const sigArgs = {
    signature: headerValue(headers, SIGNATURE_HEADER),
    appId: appId ?? "",
    raw,
    bodyTimestamp: timestamp ?? "",
    headerTimestamp: firstHeader(headers, TIMESTAMP_HEADERS),
  };
  entry.sig_match = {
    oa_key: trySignature({ ...sigArgs, key: usableKey(keys.oa) }),
    app_key: trySignature({ ...sigArgs, key: usableKey(keys.app) }),
  };
  return entry;
}

function firstHeader(headers: Headers, names: string[]): string | null {
  for (const n of names) {
    const v = headerValue(headers, n);
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

/** Giá trị header thử lại (tên chưa chốt: lấy header đầu tiên có chữ "retry"). */
function numRetry(headers: Headers): string | null {
  const name = Object.keys(headers).find((h) => h.toLowerCase().includes("retry"));
  if (!name) return null;
  const v = headerValue(headers, name);
  return typeof v === "string" ? v.slice(0, 20) : null;
}

/**
 * Tạo handler. Thứ tự: phân tích (đồng bộ, vài ms) → trả 200 → ghi log.
 * Không có việc nền sau khi trả response (gen2 hạn chế CPU sau đó).
 */
export function createOaHandler(deps: OaDeps) {
  const now = deps.now ?? (() => performance.now());
  let coldStart = true;

  return (req: OaRequest, res: OaResponse): void => {
    const start = now();
    const isCold = coldStart;
    coldStart = false;
    let entry: Record<string, unknown>;
    try {
      entry = analyzeOaRequest(req, safeKeys(deps.getKeys));
    } catch (e) {
      entry = { method: safeMethod(req), analyze_error: e instanceof Error ? e.name : "unknown" };
    }
    entry.duration_ms = Math.round((now() - start) * 1000) / 1000;
    entry.cold_start = isCold;

    try {
      res.status(200).json({ ok: true });
    } catch {
      // Không còn cách trả khác; vẫn ghi log bên dưới.
      entry.respond_error = true;
    }
    try {
      deps.log(entry);
    } catch {
      // Bỏ qua: không được ảnh hưởng response.
    }
  };
}

function safeKeys(getKeys: () => OaKeys): OaKeys {
  try {
    return getKeys();
  } catch {
    return {};
  }
}

function safeMethod(req: OaRequest): string | null {
  try {
    return typeof req.method === "string" ? req.method : null;
  } catch {
    return null;
  }
}
