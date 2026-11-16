import { beforeEach, describe, expect, it, vi } from "vitest";
import { BotConfig, DEFAULT_CONFIG } from "../src/config";
import type { ConversationRecord, Store } from "../src/store";
import { handleWebhook, Logger, redactBody, WebhookDeps } from "../src/webhook";
import type { ZaloClient, ZaloResult } from "../src/zaloClient";

// Giá trị giả, chỉ dùng trong kiểm thử.
const SECRET = "test-webhook-secret";
const GROUP = "zgr-FAKEGROUP000000000001";
const OTHER_GROUP = "zgr-0000000000000000000";
const NOW = Date.parse("2026-11-16T03:00:00Z"); // tháng 2026-11 giờ VN

class FakeStore implements Store {
  config: BotConfig = { ...DEFAULT_CONFIG, allowedChatIds: [GROUP] };
  events = new Map<string, string>();
  conversations = new Map<string, ConversationRecord>();
  usage = new Map<string, { messages_sent: number; send_errors: number; warned: boolean }>();
  calls: string[] = [];

  private u(month: string) {
    if (!this.usage.has(month)) this.usage.set(month, { messages_sent: 0, send_errors: 0, warned: false });
    return this.usage.get(month)!;
  }
  async getConfig() {
    this.calls.push("getConfig");
    return { config: this.config, warnings: [] };
  }
  async claimEvent(id: string) {
    this.calls.push("claimEvent");
    if (this.events.has(id)) return false;
    this.events.set(id, "processing");
    return true;
  }
  async setEventState(id: string, state: "done" | "failed") {
    this.calls.push("setEventState");
    this.events.set(id, state);
  }
  async getMonthlySent(month: string) {
    this.calls.push("getMonthlySent");
    return this.u(month).messages_sent;
  }
  async recordSendSuccess(month: string) {
    this.calls.push("recordSendSuccess");
    this.u(month).messages_sent++;
  }
  async recordSendError(month: string) {
    this.calls.push("recordSendError");
    this.u(month).send_errors++;
  }
  async markQuotaWarning(month: string) {
    const u = this.u(month);
    if (u.warned) return false;
    u.warned = true;
    return true;
  }
  async writeConversation(id: string, rec: ConversationRecord) {
    this.calls.push("writeConversation");
    this.conversations.set(id, rec);
  }
}

function makeLogger() {
  const lines: { level: string; message: string; data?: Record<string, unknown> }[] = [];
  const logger: Logger = {
    info: (message, data) => lines.push({ level: "info", message, data }),
    warn: (message, data) => lines.push({ level: "warn", message, data }),
    error: (message, data) => lines.push({ level: "error", message, data }),
  };
  return { logger, lines };
}

function makeClient(result: ZaloResult = { ok: true, result: {} }) {
  const sendMessage = vi.fn(async (_chatId: string, _text: string) => result);
  const client = { sendMessage } as unknown as ZaloClient;
  return { client, sendMessage };
}

function textEvent(overrides: Partial<{ id: string; text: string; chatId: string; chatType: string; event: string }> = {}) {
  return {
    event_name: overrides.event ?? "message.text.received",
    message: {
      message_id: overrides.id ?? "FAKEMSG00000000000001",
      date: 1794668448525,
      message_type: "CHAT_TEXT",
      from: { id: "FAKEUSER0000000000001", display_name: "Ten Nguoi Dung", is_bot: false },
      chat: { id: overrides.chatId ?? GROUP, chat_type: overrides.chatType ?? "GROUP" },
      text: overrides.text ?? "@Bot TTHC Đảng xin chào",
    },
  };
}

const post = (body: unknown, secret: string | null = SECRET) => ({
  method: "POST",
  headers: secret === null ? {} : { "x-bot-api-secret-token": secret },
  body,
});

let store: FakeStore;
let log: ReturnType<typeof makeLogger>;
let zalo: ReturnType<typeof makeClient>;
let deps: WebhookDeps;

function setup(result?: ZaloResult) {
  store = new FakeStore();
  log = makeLogger();
  zalo = makeClient(result);
  let t = NOW;
  deps = {
    webhookSecret: SECRET,
    store,
    getZaloClient: () => zalo.client,
    logger: log.logger,
    now: () => (t += 5),
  };
}

beforeEach(() => setup());

describe("phương thức và xác thực", () => {
  it("GET → 405", async () => {
    const r = await handleWebhook({ method: "GET", headers: {}, body: undefined }, deps);
    expect(r.status).toBe(405);
    expect(store.calls).toEqual([]);
  });

  it("thiếu header → 401, không đọc/ghi gì, không ghi nhật ký", async () => {
    const r = await handleWebhook(post(textEvent(), null), deps);
    expect(r.status).toBe(401);
    expect(store.calls).toEqual([]);
    expect(log.lines).toEqual([]);
    expect(zalo.sendMessage).not.toHaveBeenCalled();
  });

  it("sai header → 401, không đọc/ghi gì, không ghi nhật ký", async () => {
    const r = await handleWebhook(post(textEvent(), "wrong-secret"), deps);
    expect(r.status).toBe(401);
    expect(store.calls).toEqual([]);
    expect(log.lines).toEqual([]);
  });
});

describe("trả lời trong nhóm được phép", () => {
  it("cắt @, gửi 'Đã nhận: ...' đúng nhóm, tăng bộ đếm, ghi nhật ký", async () => {
    const r = await handleWebhook(post(textEvent()), deps);
    expect(r).toEqual({ status: 200, body: "ok" });
    expect(zalo.sendMessage).toHaveBeenCalledWith(GROUP, "Đã nhận: xin chào");
    expect(store.usage.get("2026-11")?.messages_sent).toBe(1);
    expect(store.events.get("FAKEMSG00000000000001")).toBe("done");
    const rec = store.conversations.get("FAKEMSG00000000000001")!;
    expect(rec).toMatchObject({
      chat_id: GROUP,
      from_id: "FAKEUSER0000000000001",
      display_name: "Ten Nguoi Dung",
      question: "xin chào",
      reply_text: "Đã nhận: xin chào",
      outcome: "replied",
      ignore_reason: null,
      error: null,
    });
    expect(rec.duration_ms).toBeGreaterThan(0);
  });

  it("chỉ có @ → gửi tin hướng dẫn", async () => {
    await handleWebhook(post(textEvent({ text: "@Bot TTHC Đảng   " })), deps);
    expect(zalo.sendMessage).toHaveBeenCalledWith(GROUP, "Vui lòng nhắn @Bot TTHC Đảng kèm câu hỏi.");
  });

  it("nhiều nhóm trong allowed_chat_ids đều được trả lời", async () => {
    store.config.allowedChatIds = [GROUP, OTHER_GROUP];
    await handleWebhook(post(textEvent({ id: "m1" })), deps);
    await handleWebhook(post(textEvent({ id: "m2", chatId: OTHER_GROUP })), deps);
    expect(zalo.sendMessage).toHaveBeenNthCalledWith(1, GROUP, "Đã nhận: xin chào");
    expect(zalo.sendMessage).toHaveBeenNthCalledWith(2, OTHER_GROUP, "Đã nhận: xin chào");
  });

  it("câu trả lời cắt còn tối đa 2000 ký tự", async () => {
    await handleWebhook(post(textEvent({ text: "@Bot TTHC Đảng " + "a".repeat(3000) })), deps);
    const text = zalo.sendMessage.mock.calls[0][1];
    expect(Array.from(text).length).toBe(2000);
    expect(text.startsWith("Đã nhận: ")).toBe(true);
  });

  it("thân bọc trong 'result' cũng xử lý được", async () => {
    await handleWebhook(post({ ok: true, result: textEvent() }), deps);
    expect(zalo.sendMessage).toHaveBeenCalledWith(GROUP, "Đã nhận: xin chào");
    expect(log.lines.some((l) => l.message.includes("bọc 'result'"))).toBe(true);
  });
});

describe("chống trùng", () => {
  it("cùng message_id gửi hai lần chỉ trả lời một lần", async () => {
    const r1 = await handleWebhook(post(textEvent()), deps);
    const r2 = await handleWebhook(post(textEvent()), deps);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(zalo.sendMessage).toHaveBeenCalledTimes(1);
    expect(store.usage.get("2026-11")?.messages_sent).toBe(1);
    expect(log.lines.some((l) => l.message.includes("trùng"))).toBe(true);
  });
});

describe("quyết định bỏ qua", () => {
  it("sự kiện ảnh → ignored, không gửi, không lưu nội dung", async () => {
    const ev = textEvent({ event: "message.image.received" });
    const r = await handleWebhook(post(ev), deps);
    expect(r.status).toBe(200);
    expect(zalo.sendMessage).not.toHaveBeenCalled();
    expect(store.conversations.get("FAKEMSG00000000000001")).toMatchObject({
      outcome: "ignored",
      ignore_reason: "unsupported_event:message.image.received",
      question: null,
    });
  });

  it("chat riêng (PRIVATE) → ignored", async () => {
    await handleWebhook(post(textEvent({ chatType: "PRIVATE", chatId: "FAKEUSER0000000000001" })), deps);
    expect(zalo.sendMessage).not.toHaveBeenCalled();
    expect(store.conversations.get("FAKEMSG00000000000001")).toMatchObject({
      outcome: "ignored",
      ignore_reason: "not_group:PRIVATE",
    });
  });

  it("nhóm không được phép → không trả lời, không lưu conversations, có dòng log chứa chat_id", async () => {
    const r = await handleWebhook(post(textEvent({ chatId: OTHER_GROUP })), deps);
    expect(r.status).toBe(200);
    expect(zalo.sendMessage).not.toHaveBeenCalled();
    expect(store.conversations.size).toBe(0);
    expect(store.calls).not.toContain("claimEvent");
    const line = log.lines.find((l) => l.message === "Nhóm không được phép");
    expect(line?.data?.chat_id).toBe(OTHER_GROUP);
  });

  it("không có @tên bot → ignored no_mention", async () => {
    await handleWebhook(post(textEvent({ text: "xin chào mọi người" })), deps);
    expect(zalo.sendMessage).not.toHaveBeenCalled();
    expect(store.conversations.get("FAKEMSG00000000000001")?.ignore_reason).toBe("no_mention");
  });

  it("reply_enabled=false → ignored reply_disabled, vẫn ghi nhật ký", async () => {
    store.config.replyEnabled = false;
    await handleWebhook(post(textEvent()), deps);
    expect(zalo.sendMessage).not.toHaveBeenCalled();
    expect(store.conversations.get("FAKEMSG00000000000001")).toMatchObject({
      outcome: "ignored",
      ignore_reason: "reply_disabled",
      question: "xin chào",
    });
  });

  it("hết hạn mức → ignored quota, không gửi", async () => {
    store.config.monthlyMessageLimit = 3;
    store.usage.set("2026-11", { messages_sent: 3, send_errors: 0, warned: true });
    await handleWebhook(post(textEvent()), deps);
    expect(zalo.sendMessage).not.toHaveBeenCalled();
    expect(store.conversations.get("FAKEMSG00000000000001")?.ignore_reason).toBe("quota");
  });

  it("đạt 80% hạn mức → một dòng cảnh báo, chỉ một lần trong tháng", async () => {
    store.config.monthlyMessageLimit = 10;
    store.usage.set("2026-11", { messages_sent: 7, send_errors: 0, warned: false });
    await handleWebhook(post(textEvent({ id: "a" })), deps); // 8/10
    await handleWebhook(post(textEvent({ id: "b" })), deps); // 9/10
    const warns = log.lines.filter((l) => l.message.includes("80%"));
    expect(warns.length).toBe(1);
    expect(warns[0].data?.messages_sent).toBe(8);
  });

  it("thân khác mẫu (thiếu message) → 200, ghi cảnh báo, không xử lý", async () => {
    const r = await handleWebhook(post({ foo: "bar" }), deps);
    expect(r.status).toBe(200);
    expect(log.lines.some((l) => l.level === "warn" && l.message.includes("khác mẫu"))).toBe(true);
    expect(zalo.sendMessage).not.toHaveBeenCalled();
  });
});

describe("lỗi gửi và lỗi bất ngờ", () => {
  it("sendMessage thất bại → 200, outcome=error, tăng send_errors, state=failed", async () => {
    setup({ ok: false, error: { code: "api_error", description: "sendMessage: bad", httpStatus: 400 } });
    const r = await handleWebhook(post(textEvent()), deps);
    expect(r.status).toBe(200);
    expect(store.usage.get("2026-11")).toMatchObject({ messages_sent: 0, send_errors: 1 });
    expect(store.events.get("FAKEMSG00000000000001")).toBe("failed");
    expect(store.conversations.get("FAKEMSG00000000000001")).toMatchObject({
      outcome: "error",
      error: "api_error: sendMessage: bad",
    });
  });

  it("store ném lỗi → vẫn trả 200, đánh dấu failed", async () => {
    store.getMonthlySent = async () => {
      throw new Error("firestore down");
    };
    const r = await handleWebhook(post(textEvent()), deps);
    expect(r.status).toBe(200);
    expect(store.events.get("FAKEMSG00000000000001")).toBe("failed");
    expect(log.lines.some((l) => l.level === "error")).toBe(true);
  });
});

describe("ghi thân thô đã che", () => {
  it("log_raw_body=true ghi thân, che tên, nội dung, mã người dùng; giữ mã nhóm và cấu trúc", async () => {
    await handleWebhook(post(textEvent()), deps);
    const line = log.lines.find((l) => l.message.startsWith("Thân webhook"));
    const dump = JSON.stringify(line?.data);
    expect(dump).not.toContain("Ten Nguoi Dung");
    expect(dump).not.toContain("xin chào");
    expect(dump).not.toContain("FAKEUSER0000000000001");
    expect(dump).toContain(GROUP);
    expect(dump).toContain("message.text.received");
  });

  it("log_raw_body=false không ghi thân", async () => {
    store.config.logRawBody = false;
    await handleWebhook(post(textEvent()), deps);
    expect(log.lines.some((l) => l.message.startsWith("Thân webhook"))).toBe(false);
  });

  it("redactBody che chat.id của chat riêng (bằng mã người dùng), giữ mã nhóm", () => {
    const priv = JSON.stringify(redactBody({ message: { chat: { id: "user-xyz", chat_type: "PRIVATE" } } }));
    const grp = JSON.stringify(redactBody({ message: { chat: { id: "zgr-abc", chat_type: "GROUP" } } }));
    expect(priv).not.toContain("user-xyz");
    expect(grp).toContain("zgr-abc");
  });

  it("redactBody che cả caption và photo_url", () => {
    const out = JSON.stringify(
      redactBody({ message: { caption: "@Bot hỏi", photo_url: "https://zalo/x.jpg", from: { id: "u1" } } }),
    );
    expect(out).not.toContain("hỏi");
    expect(out).not.toContain("zalo/x.jpg");
    expect(out).not.toContain("u1");
  });
});
