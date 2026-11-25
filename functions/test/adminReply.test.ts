/**
 * sendReplyToAskers / skipAsks: handler thật + FirestoreReplyRepo trên Firestore giả.
 * Kịch bản theo docs/spec-tra-loi-nguoi-hoi.md mục 8 (A4, A5, A6, A11, A14, A16, A17) và R1–R7.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    increment: (n: number) => ({ __inc: n }),
    serverTimestamp: () => ({ __ts: true }),
    arrayUnion: (...v: unknown[]) => ({ __union: v }),
  },
  Timestamp: { fromMillis: (ms: number) => ({ __ms: ms }) },
}));

import type { Firestore } from "firebase-admin/firestore";
import { handleSendReply, handleSkipAsks, ReplyDeps, SENDING_STALE_MS } from "../src/adminReply";
import { BotConfig, DEFAULT_CONFIG } from "../src/config";
import { FirestoreReplyRepo } from "../src/replyStore";
import type { ZaloClient, ZaloResult } from "../src/zaloClient";
import { Data, FakeDb } from "./helpers/fakeDb";

const GA = "zgr-FAKEGROUPA00000000001";
const GB = "zgr-FAKEGROUPB00000000002";
const U = "u1";
const NOW = Date.parse("2026-11-16T03:00:00Z");
const ADMIN = { uid: "admin-uid", email: "admin@example.test" };
const ts = (ms: number) => ({ toMillis: () => ms });

let db: FakeDb;
let clock: number;
let config: BotConfig;
let sendMessage: ReturnType<typeof vi.fn>;
let sleep: ReturnType<typeof vi.fn>;
let logs: { level: string; m: string; d?: Record<string, unknown> }[];
let deps: ReplyDeps;
let batchSeq: number;

function ask(id: string, chatId: string | null, name: string | null, question: string, minutesAgo: number, extra: Data = {}) {
  db.docs.set(`unanswered/${U}/asks/${id}`, {
    chat_id: chatId,
    chat_type: "GROUP",
    from_id: `from-${name}`,
    display_name: name,
    question,
    message_id: id,
    asked_at: ts(NOW - minutesAgo * 60_000),
    reply_status: "pending",
    replied_at: null,
    reply_error: null,
    reply_batch_id: null,
    ...extra,
  });
}

const askDoc = (id: string) => db.docs.get(`unanswered/${U}/asks/${id}`)!;
const parent = () => db.docs.get(`unanswered/${U}`)!;
const send = (data: Data, caller: { uid?: string; email?: string | null } = ADMIN) => handleSendReply(caller, data, deps);
const input = (askIds: string[], answerText = "Vào mục Thuế.") => ({ unansweredId: U, answerText, askIds, kbItemId: "nop-thue" });

beforeEach(() => {
  db = new FakeDb();
  clock = NOW;
  batchSeq = 0;
  logs = [];
  config = { ...DEFAULT_CONFIG, allowedChatIds: [GA, GB], chatLabels: { [GA]: "Nhóm A" } };
  sendMessage = vi.fn(async (): Promise<ZaloResult> => ({ ok: true, result: {} }));
  sleep = vi.fn(async () => {});
  db.docs.set(`unanswered/${U}`, { status: "answered", count: 3, pending_ask_count: 0 });
  deps = {
    isAdmin: async (uid) => uid === ADMIN.uid,
    repo: new FirestoreReplyRepo(db as unknown as Firestore, () => clock),
    getConfig: async () => config,
    getZaloClient: () => ({ sendMessage }) as unknown as ZaloClient,
    logger: {
      info: (m, d) => logs.push({ level: "info", m, d }),
      warn: (m, d) => logs.push({ level: "warn", m, d }),
      error: (m, d) => logs.push({ level: "error", m, d }),
    },
    newBatchId: () => `batch${++batchSeq}`,
    now: () => clock,
    sleep,
  };
});

function seedPending(n: number) {
  db.docs.set(`unanswered/${U}`, { ...parent(), pending_ask_count: n });
}

describe("quyền (A11)", () => {
  it("chưa đăng nhập → unauthenticated; không phải admin → permission-denied; không gửi, không ghi", async () => {
    ask("a1", GA, "X", "Nộp thuế ở đâu?", 10);
    expect(await send(input(["a1"]), {})).toMatchObject({ ok: false, code: "unauthenticated" });
    expect(await send(input(["a1"]), { uid: "khac", email: "x@y" })).toMatchObject({ ok: false, code: "permission-denied" });
    expect(await handleSkipAsks({ uid: "khac" }, { unansweredId: U, askIds: ["a1"] }, deps)).toMatchObject({
      code: "permission-denied",
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(askDoc("a1").reply_status).toBe("pending");
    expect(db.transactions).toBe(0);
  });
});

describe("kiểm tra input", () => {
  it("đáp án rỗng, askIds rỗng, id lạ, kbItemId sai → invalid-argument", async () => {
    for (const d of [
      input(["a1"], "   "),
      input([]),
      { ...input(["a1"]), askIds: "a1" },
      { ...input(["a/1"]) },
      { ...input(["a1"]), unansweredId: "" },
      { ...input(["a1"]), kbItemId: "Sai Slug" },
      input(["a1"], "x".repeat(2001)),
    ]) {
      expect(await send(d)).toMatchObject({ ok: false, code: "invalid-argument" });
    }
    expect(db.transactions).toBe(0);
  });

  it("ask không thuộc unanswered → invalid-argument, không ask nào bị nhận; unanswered không có → not-found", async () => {
    ask("a1", GA, "X", "q", 10);
    expect(await send(input(["a1", "khong-co"]))).toMatchObject({ ok: false, code: "invalid-argument" });
    expect(askDoc("a1").reply_status).toBe("pending");
    expect(await send({ ...input(["a1"]), unansweredId: "khac" })).toMatchObject({ ok: false, code: "not-found" });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("gửi đúng nhóm", () => {
  it("A4: hai người cùng nhóm A → 1 tin liệt kê cả 2 tên; ask sent; pending_ask_count giảm; admin_replies", async () => {
    ask("a1", GA, "Người X", "Nộp thuế ở đâu?", 30);
    ask("a2", GA, "Người Y", "nop thue o dau", 10);
    seedPending(2);
    const r = await send(input(["a1", "a2"]));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(GA, '📌 Trả lời câu hỏi của Người X, Người Y:\n"nop thue o dau"\n\nVào mục Thuế.');
    expect(r).toEqual({
      ok: true,
      batchId: "batch1",
      results: [
        {
          chat_id: GA,
          chat_name: "Nhóm A",
          ask_ids: ["a1", "a2"],
          ask_count: 2,
          status: "sent",
          error: null,
          text: '📌 Trả lời câu hỏi của Người X, Người Y:\n"nop thue o dau"\n\nVào mục Thuế.',
        },
      ],
    });
    for (const id of ["a1", "a2"]) {
      expect(askDoc(id)).toMatchObject({ reply_status: "sent", replied_at: "SERVER_TS", reply_error: null, reply_batch_id: "batch1" });
    }
    expect(parent().pending_ask_count).toBe(0);
    expect(db.docs.get("admin_replies/batch1")).toEqual({
      unanswered_id: U,
      kb_item_id: "nop-thue",
      answer_text: "Vào mục Thuế.",
      sent_by: ADMIN.email,
      sent_by_uid: ADMIN.uid,
      results: [{ chat_id: GA, ask_ids: ["a1", "a2"], status: "sent", error: null, sent_at: { __ms: NOW } }],
      created_at: "SERVER_TS",
    });
    expect(db.docs.get("usage/2026-11")).toMatchObject({ messages_sent: 1, admin_replies_sent: 1 });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("A14: X hỏi ở nhóm A, Y ở nhóm B → mỗi nhóm 1 tin chỉ có tên người trong nhóm đó; nghỉ giữa hai nhóm", async () => {
    ask("a1", GA, "Người X", "câu X", 30);
    ask("b1", GB, "Người Y", "câu Y", 10);
    seedPending(2);
    await send(input(["a1", "b1"]));
    expect(sendMessage).toHaveBeenCalledTimes(2);
    const byChat = Object.fromEntries(sendMessage.mock.calls.map(([c, t]) => [c, t as string]));
    expect(byChat[GA]).toContain("Người X");
    expect(byChat[GA]).not.toContain("Người Y");
    expect(byChat[GA]).not.toContain("câu Y");
    expect(byChat[GB]).toContain("Người Y");
    expect(byChat[GB]).not.toContain("Người X");
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it("A17: input có chat_id giả mạo → bị bỏ qua, vẫn gửi theo chat_id của ask", async () => {
    ask("a1", GA, "X", "q", 10);
    await send({ ...input(["a1"]), chat_id: "zgr-EVIL", chatId: "zgr-EVIL", chat_ids: ["zgr-EVIL"] });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toBe(GA);
  });

  it("A16: chỉ chọn ask nhóm A → chỉ nhóm A nhận; ask nhóm B giữ pending", async () => {
    ask("a1", GA, "X", "q", 10);
    ask("b1", GB, "Y", "q", 10);
    seedPending(2);
    await send(input(["a1"]));
    expect(sendMessage.mock.calls.map((c) => c[0])).toEqual([GA]);
    expect(askDoc("b1").reply_status).toBe("pending");
    expect(parent().pending_ask_count).toBe(1);
  });

  it("A5: gửi lần 2 cho cùng ask → không gửi lại, kết quả skipped ALREADY_SENT", async () => {
    ask("a1", GA, "X", "q", 10);
    seedPending(1);
    await send(input(["a1"]));
    const r = await send(input(["a1"]));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, results: [{ chat_id: GA, status: "skipped", error: "ALREADY_SENT", ask_ids: ["a1"] }] });
    expect(parent().pending_ask_count).toBe(0);
  });

  it("A6: nhóm B lỗi Zalo → B failed kèm lỗi, A vẫn gửi; Gửi lại ask lỗi chỉ gửi nhóm B", async () => {
    ask("a1", GA, "X", "q", 30);
    ask("b1", GB, "Y", "q", 10);
    seedPending(2);
    sendMessage.mockImplementation(async (chatId: string): Promise<ZaloResult> =>
      chatId === GB
        ? { ok: false, error: { code: "api_error", description: "sendMessage: bot not in group", zaloErrorCode: -201 } }
        : { ok: true, result: {} },
    );
    const r = await send(input(["a1", "b1"]));
    expect(r).toMatchObject({
      ok: true,
      results: [
        { chat_id: GA, status: "sent", error: null },
        { chat_id: GB, chat_name: null, status: "failed", error: "api_error[-201]: sendMessage: bot not in group" },
      ],
    });
    expect(askDoc("b1")).toMatchObject({ reply_status: "failed", reply_error: "api_error[-201]: sendMessage: bot not in group" });
    expect(parent().pending_ask_count).toBe(1);
    expect(db.docs.get("usage/2026-11")).toMatchObject({
      messages_sent: 2,
      admin_replies_sent: 1,
      send_errors: 1,
      admin_reply_errors: 1,
    });

    sendMessage.mockReset();
    sendMessage.mockResolvedValue({ ok: true, result: {} });
    const again = await send(input(["b1"]));
    expect(sendMessage.mock.calls.map((c) => c[0])).toEqual([GB]);
    expect(again).toMatchObject({ results: [{ chat_id: GB, status: "sent" }] });
    expect(askDoc("b1")).toMatchObject({ reply_status: "sent", reply_error: null, reply_batch_id: "batch2" });
    expect(parent().pending_ask_count).toBe(0);
  });

  it("R5: ask không có chat_id → failed MISSING_CHAT_ID, không gửi", async () => {
    ask("a1", null, "X", "q", 10);
    const r = await send(input(["a1"]));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(r).toMatchObject({ results: [{ chat_id: null, status: "failed", error: "MISSING_CHAT_ID" }] });
    expect(askDoc("a1").reply_status).toBe("failed");
  });

  it("tin > 2000 ký tự → failed TEXT_TOO_LONG, không gửi, không tăng bộ đếm", async () => {
    ask("a1", GA, "X", "q", 10);
    const r = await send(input(["a1"], "x".repeat(1990)));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(r).toMatchObject({ results: [{ status: "failed", error: "TEXT_TOO_LONG" }] });
    expect(db.docs.get("usage/2026-11")).toBeUndefined();
  });

  it("hết hạn mức tin tháng → failed QUOTA_EXCEEDED, không gửi", async () => {
    config = { ...config, monthlyMessageLimit: 5 };
    db.docs.set("usage/2026-11", { messages_sent: 5 });
    ask("a1", GA, "X", "q", 10);
    const r = await send(input(["a1"]));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(r).toMatchObject({ results: [{ status: "failed", error: "QUOTA_EXCEEDED" }] });
  });

  it("nhóm không còn trong cấu hình → vẫn gửi theo ask, chỉ ghi cảnh báo", async () => {
    config = { ...config, allowedChatIds: [GB] };
    ask("a1", GA, "X", "q", 10);
    await send(input(["a1"]));
    expect(sendMessage.mock.calls[0][0]).toBe(GA);
    expect(logs.some((l) => l.level === "warn" && l.d?.chat_id === GA)).toBe(true);
  });

  it("ask đang sending (lần bấm khác) → skipped IN_PROGRESS; sending quá hạn → được nhận lại", async () => {
    ask("a1", GA, "X", "q", 10, { reply_status: "sending", sending_at: ts(NOW - 60_000) });
    ask("a2", GB, "Y", "q", 10, { reply_status: "sending", sending_at: ts(NOW - SENDING_STALE_MS - 1) });
    const r = await send(input(["a1", "a2"]));
    expect(sendMessage.mock.calls.map((c) => c[0])).toEqual([GB]);
    expect(r).toMatchObject({
      results: [
        { chat_id: GB, status: "sent" },
        { chat_id: GA, status: "skipped", error: "IN_PROGRESS" },
      ],
    });
  });

  it("R7 và mục 7: log có batch_id, chat_id, ask_id; không có đáp án, tên người hỏi hay câu hỏi", async () => {
    ask("a1", GA, "Nguyễn Bí Mật", "câu hỏi riêng tư", 10);
    await send(input(["a1"], "Đáp án bí mật 123"));
    const line = logs.find((l) => l.m.includes("kết quả gửi"));
    expect(line?.d).toEqual({ batch_id: "batch1", chat_id: GA, ask_ids: ["a1"], status: "sent", error_code: null });
    const all = JSON.stringify(logs);
    for (const s of ["Đáp án bí mật", "Nguyễn Bí Mật", "câu hỏi riêng tư"]) expect(all).not.toContain(s);
  });

  it("lỗi bất ngờ giữa chừng → nhóm chưa xử lý được nhả về failed INTERNAL để gửi lại", async () => {
    ask("a1", GA, "X", "q", 30);
    ask("b1", GB, "Y", "q", 10);
    sendMessage.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    const r = await send(input(["a1", "b1"]));
    expect(r).toMatchObject({
      ok: true,
      results: [
        { chat_id: GA, status: "failed", error: "UNKNOWN_STATE" },
        { chat_id: GB, error: "INTERNAL" },
      ],
    });
    expect(askDoc("b1").reply_status).toBe("failed");
    expect(askDoc("a1").reply_status).toBe("sending");
  });
});

describe("Lịch sử (Bước 6)", () => {
  const convs = () => [...db.docs.entries()].filter(([k]) => k.startsWith("conversations/"));

  it("mỗi nhóm gửi được → 1 bản ghi conversations outcome admin_reply; nhóm lỗi không có bản ghi", async () => {
    ask("a1", GA, "Người X", "câu cũ", 30);
    ask("a2", GA, "Người X", "câu mới của X", 20);
    ask("a3", GA, "Người Z", "câu Z", 10);
    ask("b1", GB, "Người Y", "câu Y", 5);
    sendMessage.mockImplementation(async (chatId: string): Promise<ZaloResult> =>
      chatId === GB
        ? { ok: false, error: { code: "api_error", description: "lỗi giả", zaloErrorCode: 500 } } as unknown as ZaloResult
        : { ok: true, result: {} });
    const r = await send(input(["a1", "a2", "a3", "b1"]));
    expect(r).toMatchObject({ results: [{ chat_id: GA, status: "sent" }, { chat_id: GB, status: "failed" }] });
    expect(convs().map(([k]) => k)).toEqual(["conversations/admin_reply_batch1_1"]);
    expect(db.docs.get("conversations/admin_reply_batch1_1")).toEqual({
      chat_id: GA,
      chat_type: "GROUP",
      from_id: null,
      display_name: null,
      question: "câu Z",
      reply_text: '📌 Trả lời câu hỏi của Người X, Người Z:\n"câu Z"\n\nVào mục Thuế.',
      outcome: "admin_reply",
      ignore_reason: null,
      error: null,
      duration_ms: 0,
      matched_slug: "nop-thue",
      send_ok: true,
      admin_batch_id: "batch1",
      unanswered_id: U,
      ask_ids: ["a1", "a2", "a3"],
      reply_to_names: ["Người X", "Người Z"],
      sent_by: ADMIN.email,
      created_at: "SERVER_TS",
      expire_at: { __ms: NOW + 90 * 24 * 3600_000 },
    });
    // Gửi lại nhóm B thành công → bản ghi riêng của lần gửi mới.
    sendMessage.mockImplementation(async (): Promise<ZaloResult> => ({ ok: true, result: {} }));
    await send(input(["b1"]));
    expect(convs().map(([k]) => k)).toEqual(["conversations/admin_reply_batch1_1", "conversations/admin_reply_batch2_1"]);
    expect(db.docs.get("conversations/admin_reply_batch2_1")).toMatchObject({ chat_id: GB, reply_to_names: ["Người Y"] });
  });

  it("không cộng vào thống kê của bot (stats_daily); bỏ qua/không gửi được thì không có bản ghi", async () => {
    ask("a1", GA, "X", "q", 10);
    ask("n1", null, "N", "q", 10);
    await send(input(["a1", "n1"]));
    await send(input(["a1"])); // ALREADY_SENT
    expect(convs()).toHaveLength(1);
    expect([...db.docs.keys()].some((k) => k.startsWith("stats_daily/"))).toBe(false);
  });

  it("ghi Lịch sử lỗi → tin vẫn tính là đã gửi, chỉ ghi cảnh báo (không có nội dung tin)", async () => {
    ask("a1", GA, "Người Bí Mật", "câu riêng", 10);
    seedPending(1);
    (deps.repo as FirestoreReplyRepo).writeOutbound = async () => {
      throw new Error("ghi lỗi");
    };
    const r = await send(input(["a1"]));
    expect(r).toMatchObject({ results: [{ status: "sent", error: null }] });
    expect(askDoc("a1").reply_status).toBe("sent");
    expect(parent().pending_ask_count).toBe(0);
    const warn = logs.find((l) => l.level === "warn" && l.m.includes("Lịch sử"));
    expect(warn?.d).toEqual({ batch_id: "batch1", chat_id: GA, error: "ghi lỗi" });
    expect(JSON.stringify(logs)).not.toContain("Người Bí Mật");
  });
});

describe("skipAsks", () => {
  it("pending/failed → skipped, giảm pending_ask_count; ask đã gửi giữ nguyên", async () => {
    ask("a1", GA, "X", "q", 10);
    ask("a2", GA, "Y", "q", 10, { reply_status: "failed", reply_error: "x" });
    ask("a3", GA, "Z", "q", 10, { reply_status: "sent" });
    seedPending(2);
    const r = await handleSkipAsks(ADMIN, { unansweredId: U, askIds: ["a1", "a2", "a3"], chat_id: "zgr-EVIL" }, deps);
    expect(r).toEqual({ ok: true, skipped: ["a1", "a2"], unchanged: ["a3"] });
    expect(askDoc("a1")).toMatchObject({ reply_status: "skipped", skipped_by: ADMIN.email, skipped_at: "SERVER_TS" });
    expect(askDoc("a2")).toMatchObject({ reply_status: "skipped", reply_error: null });
    expect(askDoc("a3").reply_status).toBe("sent");
    expect(parent().pending_ask_count).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();
    // Ask đã bỏ qua: gửi sau đó cũng không gửi.
    expect(await send(input(["a1"]))).toMatchObject({ results: [{ status: "skipped", error: "ALREADY_SKIPPED" }] });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("ask không thuộc câu → invalid-argument, không đổi gì", async () => {
    ask("a1", GA, "X", "q", 10);
    expect(await handleSkipAsks(ADMIN, { unansweredId: U, askIds: ["a1", "zz"] }, deps)).toMatchObject({
      code: "invalid-argument",
    });
    expect(askDoc("a1").reply_status).toBe("pending");
  });
});
