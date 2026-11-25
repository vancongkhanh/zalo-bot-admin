/**
 * Kiểm thử FirestoreStore với một Firestore giả trong bộ nhớ.
 * (Máy chưa có Java nên chưa chạy được trình giả lập Firestore.)
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

import { CONVERSATION_TTL_MS, EVENT_TTL_MS, FirestoreStore, KB_CACHE_MS } from "../src/store";
import type { Firestore } from "firebase-admin/firestore";

import { Data, FakeDb } from "./helpers/fakeDb";

const NOW = Date.parse("2026-11-16T03:00:00Z");
let db: FakeDb;
let store: FirestoreStore;
let clock: number;

beforeEach(() => {
  db = new FakeDb();
  clock = NOW;
  store = new FirestoreStore(db as unknown as Firestore, () => clock);
});

describe("getConfig", () => {
  it("chưa có config/main → mặc định kèm cảnh báo", async () => {
    const { config, warnings } = await store.getConfig();
    expect(config.allowedChatIds).toEqual([]);
    expect(warnings.length).toBe(1);
  });
  it("đọc config/main", async () => {
    db.docs.set("config/main", { allowed_chat_ids: ["zgr-a", "zgr-b"], reply_enabled: false });
    const { config } = await store.getConfig();
    expect(config.allowedChatIds).toEqual(["zgr-a", "zgr-b"]);
    expect(config.replyEnabled).toBe(false);
  });
});

describe("chống trùng: claimEvent", () => {
  it("lần đầu tạo tài liệu processing, expire_at sau 7 ngày; lần hai trả false", async () => {
    expect(await store.claimEvent("m1")).toBe(true);
    expect(db.docs.get("processed_events/m1")).toEqual({
      received_at: "SERVER_TS",
      state: "processing",
      expire_at: { __ms: NOW + EVENT_TTL_MS },
    });
    expect(await store.claimEvent("m1")).toBe(false);
    expect(db.docs.get("processed_events/m1")?.state).toBe("processing");
  });

  it("lỗi khác ALREADY_EXISTS thì ném ra (không nuốt lỗi)", async () => {
    db.failNextCreateWith = Object.assign(new Error("14 UNAVAILABLE"), { code: 14 });
    await expect(store.claimEvent("m2")).rejects.toThrow("UNAVAILABLE");
  });

  it("setEventState cập nhật trạng thái", async () => {
    await store.claimEvent("m1");
    await store.setEventState("m1", "done");
    expect(db.docs.get("processed_events/m1")).toMatchObject({ state: "done", updated_at: "SERVER_TS" });
  });
});

describe("bộ đếm usage", () => {
  it("messages_sent đếm cả lần gửi lỗi (quyết định 3), send_errors đếm riêng", async () => {
    expect(await store.getMonthlySent("2026-11")).toBe(0);
    await store.recordSendSuccess("2026-11");
    await store.recordSendSuccess("2026-11");
    await store.recordSendError("2026-11");
    expect(await store.getMonthlySent("2026-11")).toBe(3);
    expect(db.docs.get("usage/2026-11")).toMatchObject({ messages_sent: 3, send_errors: 1 });
  });

  it("cảnh báo 80% chỉ đánh dấu một lần mỗi tháng, không xóa bộ đếm", async () => {
    await store.recordSendSuccess("2026-11");
    expect(await store.markQuotaWarning("2026-11")).toBe(true);
    expect(await store.markQuotaWarning("2026-11")).toBe(false);
    expect(await store.markQuotaWarning("2026-12")).toBe(true);
    expect(db.docs.get("usage/2026-11")).toMatchObject({ messages_sent: 1, quota_warning_sent: true });
  });
});

describe("writeConversation", () => {
  it("ghi đủ trường và created_at", async () => {
    await store.writeConversation("m1", {
      chat_id: "zgr-a",
      from_id: "u1",
      display_name: "Ten",
      question: "xin chào",
      reply_text: "Đã nhận: xin chào",
      outcome: "replied",
      ignore_reason: null,
      error: null,
      duration_ms: 123,
    });
    expect(db.docs.get("conversations/m1")).toEqual({
      chat_id: "zgr-a",
      from_id: "u1",
      display_name: "Ten",
      question: "xin chào",
      reply_text: "Đã nhận: xin chào",
      outcome: "replied",
      ignore_reason: null,
      error: null,
      duration_ms: 123,
      created_at: "SERVER_TS",
      expire_at: { __ms: NOW + CONVERSATION_TTL_MS },
    });
  });
});

describe("bước C: kho, bộ đếm AI, thống kê, unanswered", () => {
  const item = (status: string, extra: Data = {}) => ({
    title: "Ký số",
    questions: ["ký số thế nào"],
    answer: "Vào mục Ký số.",
    links: [{ label: "Video", url: "https://youtu.be/x", platform: "youtube" }],
    status,
    ...extra,
  });

  it("getApprovedItems chỉ lấy approved, sắp theo slug, cache 60 giây", async () => {
    db.docs.set("kb_items/z-muc", item("approved"));
    db.docs.set("kb_items/a-muc", item("approved"));
    db.docs.set("kb_items/nhap", item("draft"));
    const first = await store.getApprovedItems();
    expect(first.map((i) => i.slug)).toEqual(["a-muc", "z-muc"]);
    expect(first[0].links).toEqual([{ label: "Video", url: "https://youtu.be/x" }]);
    db.docs.set("kb_items/b-moi", item("approved"));
    clock += KB_CACHE_MS - 1;
    expect((await store.getApprovedItems()).length).toBe(2);
    clock += 2;
    expect((await store.getApprovedItems()).length).toBe(3);
    expect(db.reads).toBe(2);
  });

  it("recordAiCall cộng dồn ai_calls, ai_errors, token", async () => {
    await store.recordAiCall("2026-11", { ok: true, inputTokens: 100, outputTokens: 10 });
    await store.recordAiCall("2026-11", { ok: false, inputTokens: 0, outputTokens: 0 });
    expect(await store.getMonthlyAiCalls("2026-11")).toBe(2);
    expect(db.docs.get("usage/2026-11")).toMatchObject({
      ai_calls: 2,
      ai_errors: 1,
      ai_input_tokens: 100,
      ai_output_tokens: 10,
    });
  });

  it("bước F: lượt đọc ảnh tăng cả bộ đếm chung và image_*; lỗi tải ảnh; câu hỏi ảnh trong ngày", async () => {
    await store.recordAiCall("2026-11", { ok: true, inputTokens: 100, outputTokens: 10 });
    await store.recordAiCall("2026-11", { ok: true, inputTokens: 2000, outputTokens: 50, image: true });
    await store.recordAiCall("2026-11", { ok: false, inputTokens: 0, outputTokens: 0, image: true });
    await store.recordImageFetchError("2026-11");
    expect(await store.getMonthlyAiCalls("2026-11")).toBe(3);
    expect(await store.getMonthlyImageAiCalls("2026-11")).toBe(2);
    expect(await store.getMonthlyImageAiCalls("2026-12")).toBe(0);
    expect(db.docs.get("usage/2026-11")).toMatchObject({
      ai_calls: 3,
      ai_input_tokens: 2100,
      image_ai_calls: 2,
      image_ai_errors: 1,
      image_input_tokens: 2000,
      image_output_tokens: 50,
      image_fetch_errors: 1,
    });
    await store.recordDailyStat("2026-11-17", { outcome: "handoff", aiError: false, slug: null, image: true });
    expect(db.docs.get("stats_daily/2026-11-17")).toMatchObject({ questions: 1, image_questions: 1 });
  });

  it("recordDailyStat cộng questions, answered/handoff, ai_errors, item_hits", async () => {
    await store.recordDailyStat("2026-11-16", { outcome: "answered", aiError: false, slug: "ky-so" });
    await store.recordDailyStat("2026-11-16", { outcome: "answered", aiError: false, slug: "ky-so" });
    await store.recordDailyStat("2026-11-16", { outcome: "handoff", aiError: true, slug: null });
    expect(db.docs.get("stats_daily/2026-11-16")).toMatchObject({
      questions: 3,
      answered: 2,
      handoff: 1,
      ai_errors: 1,
      item_hits: { "ky-so": 2 },
    });
  });

  it("recordHit tăng hit_count, cập nhật last_hit_at", async () => {
    db.docs.set("kb_items/ky-so", item("approved", { hit_count: 4 }));
    await store.recordHit("ky-so");
    expect(db.docs.get("kb_items/ky-so")).toMatchObject({ hit_count: 5, last_hit_at: "SERVER_TS" });
  });

  it("bước F: recordUnanswered tin ảnh ghi source và image_summary; tin chữ không có hai trường này", async () => {
    await store.recordUnanswered({
      id: "img_m1",
      clusterKey: "",
      sample: "[Ảnh] Màn hình ký số báo lỗi",
      reason: "no_match",
      bestGuessSlug: null,
      bestGuessConfidence: null,
      source: "image",
      imageSummary: "Màn hình ký số báo lỗi",
    });
    expect(db.docs.get("unanswered/img_m1")).toMatchObject({ source: "image", image_summary: "Màn hình ký số báo lỗi", count: 1 });
    await store.recordUnanswered({
      id: "txt",
      clusterKey: "a",
      sample: "a",
      reason: "no_match",
      bestGuessSlug: null,
      bestGuessConfidence: null,
    });
    expect(db.docs.get("unanswered/txt")).not.toHaveProperty("source");
  });

  it("recordUnanswered: tạo new; hỏi lại tăng count, tối đa 3 mẫu; câu ignored quay về new", async () => {
    const base = {
      id: "abc",
      clusterKey: "hoi gi do",
      reason: "no_match" as const,
      bestGuessSlug: null,
      bestGuessConfidence: null,
    };
    await store.recordUnanswered({ ...base, sample: "Hỏi gì đó" });
    expect(db.docs.get("unanswered/abc")).toMatchObject({
      count: 1,
      status: "new",
      samples: ["Hỏi gì đó"],
      cluster_key: "hoi gi do",
    });
    for (const x of ["hoi gi do", "Hỏi gì đó?", "HỎI GÌ ĐÓ", "Hỏi gì đó"]) {
      await store.recordUnanswered({ ...base, sample: x });
    }
    const d = db.docs.get("unanswered/abc")!;
    expect(d.count).toBe(5);
    expect(d.samples).toEqual(["Hỏi gì đó", "hoi gi do", "Hỏi gì đó?"]);
    db.docs.set("unanswered/abc", { ...d, status: "ignored" });
    await store.recordUnanswered({
      ...base,
      sample: "x",
      reason: "low_confidence",
      bestGuessSlug: "ky-so",
      bestGuessConfidence: 0.4,
    });
    expect(db.docs.get("unanswered/abc")).toMatchObject({
      count: 6,
      status: "new",
      reason: "low_confidence",
      best_guess_slug: "ky-so",
      best_guess_confidence: 0.4,
    });
  });
});

describe("trả lời người hỏi, bước 2: asks và pending_ask_count", () => {
  const base = {
    id: "abc",
    clusterKey: "nop thue o dau",
    sample: "Nộp thuế ở đâu?",
    reason: "no_match" as const,
    bestGuessSlug: null,
    bestGuessConfidence: null,
  };
  const ask = (messageId: string, chatId: string, fromId: string, displayName: string, question = "Nộp thuế ở đâu?") => ({
    messageId,
    chatId,
    chatType: "GROUP",
    fromId,
    displayName,
    question,
  });

  it("A1: câu mới → 1 ask pending đúng nhóm, người, câu gốc; pending_ask_count = 1", async () => {
    await store.recordUnanswered({ ...base, ask: ask("m1", "zgr-a", "u1", "Người A") });
    expect(db.docs.get("unanswered/abc")).toMatchObject({ count: 1, status: "new", pending_ask_count: 1 });
    expect(db.docs.get("unanswered/abc/asks/m1")).toEqual({
      chat_id: "zgr-a",
      chat_type: "GROUP",
      from_id: "u1",
      display_name: "Người A",
      question: "Nộp thuế ở đâu?",
      message_id: "m1",
      asked_at: "SERVER_TS",
      reply_status: "pending",
      replied_at: null,
      reply_error: null,
      reply_batch_id: null,
      expire_at: { __ms: NOW + CONVERSATION_TTL_MS },
    });
  });

  it("A2: hai người ở hai nhóm hỏi cùng câu → cùng một unanswered, 2 ask riêng, pending_ask_count = 2", async () => {
    await store.recordUnanswered({ ...base, ask: ask("m1", "zgr-a", "u1", "Người A") });
    await store.recordUnanswered({ ...base, sample: "nop thue o dau", ask: ask("m2", "zgr-b", "u2", "Người B", "nop thue o dau") });
    expect(db.docs.get("unanswered/abc")).toMatchObject({ count: 2, pending_ask_count: 2 });
    expect(db.docs.get("unanswered/abc/asks/m1")).toMatchObject({ chat_id: "zgr-a", display_name: "Người A" });
    expect(db.docs.get("unanswered/abc/asks/m2")).toMatchObject({
      chat_id: "zgr-b",
      display_name: "Người B",
      question: "nop thue o dau",
    });
  });

  it("cùng message_id ghi lại → không tạo ask thứ hai, không tăng pending_ask_count", async () => {
    await store.recordUnanswered({ ...base, ask: ask("m1", "zgr-a", "u1", "Người A") });
    db.docs.set("unanswered/abc/asks/m1", { ...db.docs.get("unanswered/abc/asks/m1")!, reply_status: "sent" });
    await store.recordUnanswered({ ...base, ask: ask("m1", "zgr-a", "u1", "Người A") });
    expect(db.docs.get("unanswered/abc")?.pending_ask_count).toBe(1);
    expect(db.docs.get("unanswered/abc/asks/m1")?.reply_status).toBe("sent");
  });

  it("câu đã answered được hỏi lại → thêm ask pending, câu quay về new như cũ", async () => {
    await store.recordUnanswered({ ...base, ask: ask("m1", "zgr-a", "u1", "Người A") });
    db.docs.set("unanswered/abc", { ...db.docs.get("unanswered/abc")!, status: "answered", pending_ask_count: 0 });
    await store.recordUnanswered({ ...base, ask: ask("m2", "zgr-a", "u2", "Người B") });
    expect(db.docs.get("unanswered/abc")).toMatchObject({ status: "new", pending_ask_count: 1, count: 2 });
  });

  it("câu hỏi cắt còn 500 ký tự; tin ảnh ghi source; không có ask thì pending_ask_count = 0", async () => {
    await store.recordUnanswered({ ...base, ask: ask("m1", "zgr-a", "u1", "A", "ệ".repeat(600)) });
    expect(Array.from(db.docs.get("unanswered/abc/asks/m1")?.question as string)).toHaveLength(500);
    await store.recordUnanswered({
      ...base,
      id: "img_m9",
      clusterKey: "",
      sample: "[Ảnh] x",
      source: "image",
      imageSummary: "x",
      ask: ask("m9", "zgr-a", "u1", "A", ""),
    });
    expect(db.docs.get("unanswered/img_m9/asks/m9")).toMatchObject({ source: "image", question: "" });
    await store.recordUnanswered({ ...base, id: "noask" });
    expect(db.docs.get("unanswered/noask")?.pending_ask_count).toBe(0);
  });
});
