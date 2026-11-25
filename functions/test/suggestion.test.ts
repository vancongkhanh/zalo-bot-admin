/**
 * addSuggestedQuestion: handler thật + FirestoreSuggestionRepo trên Firestore giả.
 * Kịch bản theo docs/spec-them-cau-hoi-goi-y.md mục 8 (S4, S6, S7, S9, S11) và các điểm đã chốt.
 */
import { readFileSync } from "node:fs";
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
import {
  cleanSuggestion,
  handleAddSuggestion,
  hasPersonalInfo,
  MAX_ITEM_QUESTIONS,
  normalizeSuggestion,
  SuggestionDeps,
} from "../src/suggestion";
import { FirestoreSuggestionRepo } from "../src/suggestionStore";
import { Data, FakeDb } from "./helpers/fakeDb";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/suggestion-text.json", import.meta.url), "utf8")) as {
  botName: string;
  normalize: { in: string; out: string }[];
  clean: { in: string; out: string }[];
  pii: { in: string; out: boolean }[];
};

const ADMIN = { uid: "admin-uid", email: "admin@example.test" };
const BOT = "Bot TTHC Đảng";

let db: FakeDb;
let logs: { m: string; d?: Record<string, unknown> }[];
let deps: SuggestionDeps;

function item(slug: string, questions: string[], extra: Data = {}) {
  db.docs.set(`kb_items/${slug}`, {
    title: `Mục ${slug}`,
    status: "approved",
    questions,
    answer: "Đáp án.",
    version: 3,
    approved_by: "nguoi-duyet@example.test",
    approved_at: "APPROVED_TS",
    updated_by: "nguoi-duyet@example.test",
    ...extra,
  });
}

function history(id: string, extra: Data = {}) {
  db.docs.set(`conversations/${id}`, {
    outcome: "answered",
    matched_slug: "ky-so",
    send_ok: true,
    question: "cài chữ ký số thế nào",
    confidence: 0.8,
    ...extra,
  });
}

const add = (data: Data, caller: { uid?: string; email?: string | null } = ADMIN) => handleAddSuggestion(caller, data, deps);
const input = (o: Data = {}) => ({ historyId: "h1", kbItemId: "ky-so", question: "cài chữ ký số thế nào", ...o });
const kb = (slug: string) => db.docs.get(`kb_items/${slug}`)!;
const hist = (id = "h1") => db.docs.get(`conversations/${id}`)!;
const logDocs = () => [...db.docs.entries()].filter(([k]) => k.startsWith("kb_suggestion_log/")).map(([, v]) => v);

beforeEach(() => {
  db = new FakeDb();
  logs = [];
  deps = {
    isAdmin: async (uid) => uid === ADMIN.uid,
    getBotName: async () => BOT,
    repo: new FirestoreSuggestionRepo(db as unknown as Firestore),
    logger: { info: (m, d) => logs.push({ m, d }) },
  };
  item("ky-so", ["cài ký số", "video cài ký số"]);
  item("cau-hinh", ["cấu hình con dấu"]);
  history("h1");
});

describe("chuẩn hóa, làm sạch, thông tin cá nhân (bộ mẫu chung với trang quản trị)", () => {
  it.each(fixture.normalize)("normalize %o", ({ in: s, out }) => expect(normalizeSuggestion(s)).toBe(out));
  it.each(fixture.clean)("clean %o", ({ in: s, out }) => expect(cleanSuggestion(s, fixture.botName)).toBe(out));
  it.each(fixture.pii)("pii %o", ({ in: s, out }) => expect(hasPersonalInfo(s)).toBe(out));
});

describe("quyền và input", () => {
  it("S11: chưa đăng nhập / không phải admin → từ chối, không đọc ghi gì", async () => {
    expect(await add(input(), {})).toMatchObject({ ok: false, code: "unauthenticated" });
    expect(await add(input(), { uid: "khac", email: "x@y" })).toMatchObject({ ok: false, code: "permission-denied" });
    expect(db.transactions).toBe(0);
    expect(kb("ky-so").questions).toEqual(["cài ký số", "video cài ký số"]);
  });

  it("câu ngắn hơn 5 / dài hơn 300 ký tự, id sai, force sai kiểu → invalid-argument", async () => {
    for (const d of [
      input({ question: "ký" }),
      input({ question: "@Bot TTHC Đảng  ab " }),
      input({ question: "x".repeat(301) }),
      input({ question: 5 }),
      input({ historyId: "a/b" }),
      input({ kbItemId: "Ky So" }),
      input({ force: "yes" }),
    ]) {
      expect(await add(d)).toMatchObject({ ok: false, code: "invalid-argument" });
    }
    expect(db.transactions).toBe(0);
  });

  it("đã chốt 4.2: câu còn thông tin cá nhân hoặc phần đã ẩn → không lưu", async () => {
    for (const q of ["ký số lỗi gọi 0912 345 678", "hồ sơ [đã ẩn] lỗi ký số", "mail a@b.vn hỏi ký số"]) {
      const r = await add(input({ question: q }));
      expect(r).toMatchObject({ ok: false, code: "invalid-argument" });
      expect((r as { message: string }).message).toContain("thông tin cá nhân");
    }
    expect(db.transactions).toBe(0);
  });
});

describe("thêm câu", () => {
  it("S4: câu vào cuối danh sách, câu cũ còn nguyên; version +1; giữ người duyệt; log; đánh dấu Lịch sử", async () => {
    const r = await add(input({ question: "  @Bot TTHC Đảng cài   chữ ký số\nthế nào " }));
    expect(r).toEqual({ ok: true, status: "added", kbItemId: "ky-so", questionCount: 3, itemChanged: false });
    expect(kb("ky-so")).toMatchObject({
      questions: ["cài ký số", "video cài ký số", "cài chữ ký số thế nào"],
      version: 4,
      updated_at: "SERVER_TS",
      updated_by: ADMIN.email,
      status: "approved",
      approved_by: "nguoi-duyet@example.test",
      approved_at: "APPROVED_TS",
    });
    expect(logDocs()).toEqual([
      {
        kb_item_id: "ky-so",
        question: "cài chữ ký số thế nào",
        original_text: "cài chữ ký số thế nào",
        history_ref: "h1",
        confidence: 0.8,
        item_changed: false,
        duplicate_in_other_item: null,
        added_by: ADMIN.email,
        added_by_uid: ADMIN.uid,
        added_at: "SERVER_TS",
      },
    ]);
    expect(hist()).toMatchObject({ suggestion_added_at: "SERVER_TS", suggestion_kb_item_id: "ky-so" });
  });

  it("S5 phía server: thêm lần 2 từ cùng bản ghi → already_added, không ghi gì thêm", async () => {
    await add(input());
    const r = await add(input({ question: "câu khác hẳn về ký số" }));
    expect(r).toEqual({ ok: true, status: "already_added", kbItemId: "ky-so" });
    expect(kb("ky-so").questions).toHaveLength(3);
    expect(logDocs()).toHaveLength(1);
  });

  it("S6: đã có trong chính mục (khác hoa thường, dấu câu, khoảng trắng) → không thêm, vẫn đánh dấu Lịch sử, không log", async () => {
    const r = await add(input({ question: "Cài   KÝ SỐ???" }));
    expect(r).toEqual({ ok: true, status: "duplicate_same", kbItemId: "ky-so" });
    expect(kb("ky-so")).toMatchObject({ questions: ["cài ký số", "video cài ký số"], version: 3 });
    expect(logDocs()).toHaveLength(0);
    expect(hist()).toMatchObject({ suggestion_added_at: "SERVER_TS", suggestion_kb_item_id: "ky-so" });
  });

  it("đã chốt 4.4: câu chỉ khác dấu với câu đã có không tính là trùng", async () => {
    const r = await add(input({ question: "cai ky so" }));
    expect(r).toMatchObject({ ok: true, status: "added" });
    expect(kb("ky-so").questions).toContain("cai ky so");
  });

  it("S7: đang là gợi ý của mục khác → duplicate_other, không ghi; force → thêm, log ghi mục kia", async () => {
    const r = await add(input({ question: "Cấu hình con dấu!" }));
    expect(r).toEqual({
      ok: true,
      status: "duplicate_other",
      others: [{ slug: "cau-hinh", title: "Mục cau-hinh", status: "approved" }],
    });
    expect(kb("ky-so").questions).toHaveLength(2);
    expect(hist().suggestion_added_at).toBeUndefined();
    expect(logDocs()).toHaveLength(0);

    const r2 = await add(input({ question: "Cấu hình con dấu!", force: true }));
    expect(r2).toMatchObject({ ok: true, status: "added" });
    expect(kb("ky-so").questions).toContain("Cấu hình con dấu!");
    expect(kb("cau-hinh").questions).toEqual(["cấu hình con dấu"]);
    expect(logDocs()[0]).toMatchObject({ duplicate_in_other_item: "cau-hinh" });
  });

  it("S9: đổi sang mục khác → câu vào mục mới, item_changed = true", async () => {
    const r = await add(input({ kbItemId: "cau-hinh", question: "đóng dấu lên văn bản thế nào" }));
    expect(r).toMatchObject({ ok: true, status: "added", kbItemId: "cau-hinh", itemChanged: true });
    expect(kb("cau-hinh").questions).toEqual(["cấu hình con dấu", "đóng dấu lên văn bản thế nào"]);
    expect(kb("ky-so").questions).toHaveLength(2);
    expect(logDocs()[0]).toMatchObject({ kb_item_id: "cau-hinh", item_changed: true });
    expect(hist().suggestion_kb_item_id).toBe("cau-hinh");
  });

  it("đã chốt 4.1: mục đủ 50 câu → failed-precondition, không ghi gì", async () => {
    item("ky-so", Array.from({ length: MAX_ITEM_QUESTIONS }, (_, i) => `câu số ${i}`));
    const r = await add(input());
    expect(r).toMatchObject({ ok: false, code: "failed-precondition" });
    expect((r as { message: string }).message).toContain("50");
    expect(kb("ky-so").questions).toHaveLength(MAX_ITEM_QUESTIONS);
    expect(hist().suggestion_added_at).toBeUndefined();
  });
});

describe("điều kiện bản ghi và mục", () => {
  it.each([
    ["chuyển ca", { outcome: "handoff" }],
    ["gửi lỗi", { send_ok: false }],
    ["không có mục", { matched_slug: null }],
    ["admin trả lời", { outcome: "admin_reply" }],
    ["bot không trả lời", { outcome: "ignored", ignore_reason: "quota" }],
    ["không có chữ", { question: "" }],
  ])("bản ghi %s → failed-precondition", async (_n, extra) => {
    history("h1", extra);
    expect(await add(input())).toMatchObject({ ok: false, code: "failed-precondition" });
    expect(kb("ky-so").questions).toHaveLength(2);
  });

  it("bản ghi Lịch sử không còn → not-found; mục không còn → not-found; mục không ở Đã duyệt → failed-precondition", async () => {
    expect(await add(input({ historyId: "khong-co" }))).toMatchObject({ ok: false, code: "not-found" });
    expect(await add(input({ kbItemId: "khong-co" }))).toMatchObject({ ok: false, code: "not-found" });
    for (const status of ["hidden", "draft"]) {
      item("ky-so", ["cài ký số"], { status });
      expect(await add(input())).toMatchObject({ ok: false, code: "failed-precondition" });
    }
    expect(logDocs()).toHaveLength(0);
  });

  it("log hàm không chứa nội dung câu", async () => {
    await add(input({ question: "câu riêng tư về ký số" }));
    expect(logs).toEqual([{ m: "Thêm câu gợi ý", d: { history_id: "h1", kb_item_id: "ky-so", status: "add" } }]);
    expect(JSON.stringify(logs)).not.toContain("riêng tư");
  });
});
