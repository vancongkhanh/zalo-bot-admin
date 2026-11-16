import { describe, expect, it, vi } from "vitest";
import { createZaloClient, charLength, isValidSecretToken } from "../src/zaloClient";

// Token giả, chỉ dùng trong kiểm thử.
const TOKEN = "1234567890:FAKE-test-token_abc";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Response) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    impl(String(url), init ?? {}),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("zaloClient: gọi API đúng địa chỉ và thân", () => {
  it("sendMessage gửi POST JSON { chat_id, text } tới /bot{TOKEN}/sendMessage", async () => {
    const f = mockFetch(() => jsonResponse({ ok: true, result: { message_id: "m1" } }));
    const c = createZaloClient({ token: TOKEN, fetchImpl: f });
    const r = await c.sendMessage("zgr-abc", "Đã nhận: xin chào");

    expect(r).toEqual({ ok: true, result: { message_id: "m1" } });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(`https://bot-api.zaloplatforms.com/bot${TOKEN}/sendMessage`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ chat_id: "zgr-abc", text: "Đã nhận: xin chào" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sendPhoto gửi { chat_id, photo, caption }; bỏ caption nếu rỗng", async () => {
    const f = mockFetch(() => jsonResponse({ ok: true, result: {} }));
    const c = createZaloClient({ token: TOKEN, fetchImpl: f });
    await c.sendPhoto("zgr-abc", "https://example.com/a.png", "Bước 1");
    await c.sendPhoto("zgr-abc", "https://example.com/a.png");
    expect(f.mock.calls[0][0]).toMatch(/\/sendPhoto$/);
    expect(JSON.parse(f.mock.calls[0][1].body as string)).toEqual({
      chat_id: "zgr-abc",
      photo: "https://example.com/a.png",
      caption: "Bước 1",
    });
    expect(JSON.parse(f.mock.calls[1][1].body as string)).toEqual({
      chat_id: "zgr-abc",
      photo: "https://example.com/a.png",
    });
  });

  it("setWebhook gửi { url, secret_token }", async () => {
    const f = mockFetch(() => jsonResponse({ ok: true, result: true }));
    const c = createZaloClient({ token: TOKEN, fetchImpl: f });
    const r = await c.setWebhook("https://example.com/hook", "secret-12345");
    expect(r.ok).toBe(true);
    expect(f.mock.calls[0][0]).toMatch(/\/setWebhook$/);
    expect(JSON.parse(f.mock.calls[0][1].body as string)).toEqual({
      url: "https://example.com/hook",
      secret_token: "secret-12345",
    });
  });

  it("deleteWebhook gửi POST tới /deleteWebhook", async () => {
    const f = mockFetch(() => jsonResponse({ ok: true, result: true }));
    const c = createZaloClient({ token: TOKEN, fetchImpl: f });
    const r = await c.deleteWebhook();
    expect(r.ok).toBe(true);
    expect(f.mock.calls[0][0]).toMatch(/\/deleteWebhook$/);
    expect(f.mock.calls[0][1].method).toBe("POST");
  });
});

describe("isValidSecretToken", () => {
  it("chỉ nhận A-Z, a-z, 0-9, _ và -, dài 8-256", () => {
    expect(isValidSecretToken("Abc_def-123")).toBe(true);
    expect(isValidSecretToken("a".repeat(256))).toBe(true);
    expect(isValidSecretToken("a".repeat(7))).toBe(false);
    expect(isValidSecretToken("abc.def.123")).toBe(false);
    expect(isValidSecretToken(undefined)).toBe(false);
  });
});

describe("zaloClient: phương thức chẩn đoán", () => {
  it("getMe và getWebhookInfo gửi POST tới đúng phương thức", async () => {
    const f = mockFetch(() => jsonResponse({ ok: true, result: { id: "1" } }));
    const c = createZaloClient({ token: TOKEN, fetchImpl: f });
    expect((await c.getMe()).ok).toBe(true);
    expect((await c.getWebhookInfo()).ok).toBe(true);
    expect(f.mock.calls[0][0]).toMatch(/\/getMe$/);
    expect(f.mock.calls[1][0]).toMatch(/\/getWebhookInfo$/);
  });
});

describe("zaloClient: lỗi có cấu trúc", () => {
  it("ok: false → api_error kèm error_code và mô tả", async () => {
    const f = mockFetch(() =>
      jsonResponse({ ok: false, error_code: 400, description: "The photo must not be empty" }, 400),
    );
    const c = createZaloClient({ token: TOKEN, fetchImpl: f });
    const r = await c.sendPhoto("zgr-abc", "https://example.com/a.png");
    expect(r).toEqual({
      ok: false,
      error: {
        code: "api_error",
        description: "sendPhoto: The photo must not be empty",
        httpStatus: 400,
        zaloErrorCode: 400,
      },
    });
  });

  it("HTTP 500 thân không phải JSON → http_error", async () => {
    const f = mockFetch(() => new Response("<html>Bad gateway</html>", { status: 502 }));
    const c = createZaloClient({ token: TOKEN, fetchImpl: f });
    const r = await c.sendMessage("zgr-abc", "hi");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("http_error");
      expect(r.error.httpStatus).toBe(502);
    }
  });

  it("HTTP 200 nhưng thiếu trường ok → invalid_response", async () => {
    const f = mockFetch(() => jsonResponse({ hello: "world" }));
    const c = createZaloClient({ token: TOKEN, fetchImpl: f });
    const r = await c.sendMessage("zgr-abc", "hi");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_response");
  });

  it("hết thời gian chờ → timeout", async () => {
    const f = mockFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const c = createZaloClient({ token: TOKEN, fetchImpl: f, timeoutMs: 30 });
    const r = await c.sendMessage("zgr-abc", "hi");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("timeout");
  });

  it("lỗi mạng → network_error", async () => {
    const f = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    const c = createZaloClient({ token: TOKEN, fetchImpl: f });
    const r = await c.sendMessage("zgr-abc", "hi");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("network_error");
  });
});

describe("zaloClient: không lộ token hay secret", () => {
  it("token trong thông báo lỗi mạng bị che", async () => {
    const f = mockFetch((url) => {
      throw new TypeError(`fetch failed for ${url} (${encodeURIComponent(TOKEN)})`);
    });
    const c = createZaloClient({ token: TOKEN, fetchImpl: f });
    const r = await c.sendMessage("zgr-abc", "hi");
    const dump = JSON.stringify(r);
    expect(dump).not.toContain(TOKEN);
    expect(dump).not.toContain(encodeURIComponent(TOKEN));
    expect(dump).toContain("***");
  });

  it("token và secret_token bị che nếu Zalo trả lại trong mô tả lỗi", async () => {
    const secret = "my-webhook-secret-xyz";
    const f = mockFetch(() =>
      jsonResponse({ ok: false, error_code: 401, description: `bad ${TOKEN} / ${secret}` }, 401),
    );
    const c = createZaloClient({ token: TOKEN, fetchImpl: f });
    const r = await c.setWebhook("https://example.com/hook", secret);
    const dump = JSON.stringify(r);
    expect(dump).not.toContain(TOKEN);
    expect(dump).not.toContain(secret);
  });

  it("thiếu token thì báo lỗi ngay khi tạo client", () => {
    expect(() => createZaloClient({ token: "" })).toThrow();
  });
});

describe("zaloClient: kiểm tra tham số trước khi gọi", () => {
  it("text rỗng hoặc quá 2000 ký tự bị từ chối, không gọi API", async () => {
    const f = mockFetch(() => jsonResponse({ ok: true }));
    const c = createZaloClient({ token: TOKEN, fetchImpl: f });
    const r1 = await c.sendMessage("zgr-abc", "");
    const r2 = await c.sendMessage("zgr-abc", "a".repeat(2001));
    const r3 = await c.sendMessage("zgr-abc", "a".repeat(2000));
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    if (!r1.ok) expect(r1.error.code).toBe("invalid_argument");
    expect(r3.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("đếm ký tự theo Unicode: 2000 emoji vẫn hợp lệ", async () => {
    const f = mockFetch(() => jsonResponse({ ok: true }));
    const c = createZaloClient({ token: TOKEN, fetchImpl: f });
    const text = "😀".repeat(2000); // 4000 đơn vị UTF-16
    expect(charLength(text)).toBe(2000);
    expect((await c.sendMessage("zgr-abc", text)).ok).toBe(true);
  });

  it("setWebhook: url không HTTPS hoặc secret ngoài 8-256 ký tự bị từ chối", async () => {
    const f = mockFetch(() => jsonResponse({ ok: true }));
    const c = createZaloClient({ token: TOKEN, fetchImpl: f });
    expect((await c.setWebhook("http://example.com", "secret-12345")).ok).toBe(false);
    expect((await c.setWebhook("https://example.com", "short")).ok).toBe(false);
    expect((await c.setWebhook("https://example.com", "x".repeat(257))).ok).toBe(false);
    expect((await c.setWebhook("https://example.com", "abc def!123")).ok).toBe(false);
    expect((await c.setWebhook("https://example.com", "mậtkhẩu12345")).ok).toBe(false);
    expect((await c.setWebhook("https://example.com", "abc+def/123=")).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
