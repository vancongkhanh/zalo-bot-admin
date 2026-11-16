// Kiểm thử firestore.rules và storage.rules trên emulator (dự án demo, không đụng dữ liệu thật).
// Chạy: cd admin && npm run test:rules   (cần Java 21 và firebase-tools)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where,
  writeBatch, Timestamp,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, listAll, ref as sref, uploadBytes } from "firebase/storage";
import { logic } from "./load-logic.mjs";

const { buildItemWrite, validateItemForm, validateSettings, settingsFromConfig } = logic;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = await initializeTestEnvironment({
  projectId: "demo-zalo-bot",
  firestore: { rules: readFileSync(join(ROOT, "firestore.rules"), "utf8"), host: "127.0.0.1", port: 8080 },
  storage: { rules: readFileSync(join(ROOT, "storage.rules"), "utf8"), host: "127.0.0.1", port: 9199 },
});
afterAll(() => env.cleanup());

const ADMIN = { uid: "admin-1", email: "admin@example.com" };
const admin = () => env.authenticatedContext(ADMIN.uid, { email: ADMIN.email }).firestore();
const outsider = () => env.authenticatedContext("nguoi-ngoai", { email: "x@example.com" }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

const ITEM = {
  title: "Ký số",
  topic: "Chữ ký",
  questions: ["ký số thế nào", "cài chữ ký số"],
  answer: "Vào mục Ký số.",
  links: [{ label: "Video", url: "https://youtu.be/abc", platform: "youtube" }],
  keywords: ["ký số"],
  source: "HDSD trang 3",
  status: "approved",
  steps: [],
  image_urls: [],
  hit_count: 7,
  last_hit_at: null,
  version: 2,
  created_at: Timestamp.fromMillis(1_700_000_000_000),
  updated_at: Timestamp.fromMillis(1_700_000_000_000),
  approved_at: Timestamp.fromMillis(1_700_000_000_000),
  approved_by: "kb-approve",
};

const form = (over = {}) => ({
  slug: "doi-mat-khau", title: "Đổi mật khẩu", topic: "", questions: "đổi mật khẩu\nquên mật khẩu",
  answer: "Vào Cài đặt.", links: "", keywords: "", source: "HDSD", status: "draft", ...over,
});
const itemOf = (over) => validateItemForm(form(over)).item;

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "admins", ADMIN.uid), { email: ADMIN.email });
    await setDoc(doc(db, "kb_items", "ky-so"), ITEM);
    await setDoc(doc(db, "unanswered", "u1"), {
      cluster_key: "nop thue", samples: ["Nộp thuế?"], count: 3, status: "new", reason: "no_match",
      first_asked_at: Timestamp.now(), last_asked_at: Timestamp.now(), best_guess_slug: null, best_guess_confidence: null,
    });
    await setDoc(doc(db, "stats_daily", "2026-11-16"), { questions: 1 });
    await setDoc(doc(db, "usage", "2026-11"), { messages_sent: 1 });
    await setDoc(doc(db, "conversations", "m1"), { question: "x" });
    await setDoc(doc(db, "processed_events", "m1"), { state: "done" });
    await setDoc(doc(db, "eval_testset", "t-01"), { question: "x" });
    await setDoc(doc(db, "config", "main"), {
      allowed_chat_ids: ["g1"], bot_mention_name: "Bot TTHC Đảng", monthly_message_limit: 3000,
      reply_enabled: true, ai_enabled: false, ai_model: "claude-haiku-5-5", confidence_threshold: 0.7,
    });
  });
});

const READABLE = ["kb_items/ky-so", "unanswered/u1", "stats_daily/2026-11-16", "usage/2026-11", "conversations/m1", "config/main"];

describe("D1: ngoài admins không đọc, không ghi được", () => {
  it.each(READABLE)("đọc %s", async (path) => {
    await assertFails(getDoc(doc(outsider(), path)));
    await assertFails(getDoc(doc(anon(), path)));
  });

  it("không liệt kê được, không ghi được", async () => {
    const db = outsider();
    await assertFails(getDocs(collection(db, "kb_items")));
    await assertFails(setDoc(doc(db, "kb_items", "moi"), buildItemWrite(null, itemOf(), "x@example.com", serverTimestamp())));
    await assertFails(updateDoc(doc(db, "unanswered", "u1"), { status: "ignored", handled_by: "x@example.com" }));
    await assertFails(updateDoc(doc(db, "config", "main"), { ai_enabled: true, updated_at: serverTimestamp(), updated_by: "x@example.com" }));
  });

  it("không tự cấp quyền admin", async () => {
    await assertFails(setDoc(doc(outsider(), "admins", "nguoi-ngoai"), { email: "x@example.com" }));
    await assertFails(getDoc(doc(outsider(), "admins", ADMIN.uid)));
  });
});

describe("admin: quyền đọc", () => {
  it.each(READABLE)("đọc %s", async (path) => {
    await assertSucceeds(getDoc(doc(admin(), path)));
  });

  it("đọc tài liệu admins của chính mình, không liệt kê admins", async () => {
    await assertSucceeds(getDoc(doc(admin(), "admins", ADMIN.uid)));
    await assertFails(getDocs(collection(admin(), "admins")));
  });

  it("truy vấn màn Câu chưa trả lời", async () => {
    const q = query(collection(admin(), "unanswered"), where("status", "==", "new"),
      orderBy("count", "desc"), orderBy("last_asked_at", "desc"), limit(100));
    expect((await assertSucceeds(getDocs(q))).size).toBe(1);
  });

  it.each(["processed_events/m1", "eval_testset/t-01"])("không mở %s", async (path) => {
    await assertFails(getDoc(doc(admin(), path)));
  });
});

describe("kb_items: tạo", () => {
  const create = (slug, data) => setDoc(doc(admin(), "kb_items", slug), data);

  it("dữ liệu do trang tạo (nháp và đã duyệt) được chấp nhận", async () => {
    await assertSucceeds(create("doi-mat-khau", buildItemWrite(null, itemOf(), ADMIN.email, serverTimestamp())));
    await assertSucceeds(create("doi-mk-2", buildItemWrite(null, itemOf({ status: "approved" }), ADMIN.email, serverTimestamp())));
  });

  it("trả lời 1.500 ký tự có dấu được chấp nhận, 1.501 bị từ chối", async () => {
    const ok = buildItemWrite(null, itemOf(), ADMIN.email, serverTimestamp());
    await assertSucceeds(create("dai-1500", { ...ok, answer: "ữ".repeat(1500) }));
    await assertFails(create("dai-1501", { ...ok, answer: "ữ".repeat(1501) }));
  });

  it.each([
    ["slug sai định dạng", "Ky So", {}],
    ["bộ đếm khác 0", "a1", { hit_count: 5 }],
    ["version khác 1", "a2", { version: 3 }],
    ["trường lạ", "a3", { la: 1 }],
    ["người sửa giả", "a4", { updated_by: "khac@example.com" }],
    ["trạng thái lạ", "a5", { status: "live" }],
    ["thiếu tiêu đề", "a6", { title: "" }],
    ["nháp mà có người duyệt", "a7", { approved_by: ADMIN.email }],
  ])("từ chối: %s", async (_name, slug, over) => {
    const base = buildItemWrite(null, itemOf(), ADMIN.email, serverTimestamp());
    await assertFails(create(slug, { ...base, ...over }));
  });

  it("duyệt ngay mà thiếu nguồn hoặc chỉ 1 cách hỏi bị từ chối", async () => {
    const base = buildItemWrite(null, itemOf({ status: "approved" }), ADMIN.email, serverTimestamp());
    await assertFails(create("b1", { ...base, source: "" }));
    await assertFails(create("b2", { ...base, questions: ["một"] }));
    await assertFails(create("b3", { ...base, approved_by: "khac@example.com" }));
  });

  it("tạo đè lên slug đã có bị từ chối", async () => {
    await assertFails(create("ky-so", buildItemWrite(null, itemOf(), ADMIN.email, serverTimestamp())));
  });
});

describe("kb_items: sửa", () => {
  const upd = (data) => updateDoc(doc(admin(), "kb_items", "ky-so"), data);
  const cur = { ...ITEM };

  it("sửa nội dung mục đã duyệt bằng dữ liệu của trang được chấp nhận", async () => {
    await assertSucceeds(upd(buildItemWrite(cur, { ...cur, answer: "Mới" }, ADMIN.email, serverTimestamp())));
  });

  it("ẩn mục, đưa về nháp được chấp nhận", async () => {
    await assertSucceeds(upd(buildItemWrite(cur, { ...cur, status: "hidden" }, ADMIN.email, serverTimestamp())));
  });

  it.each([
    ["đổi hit_count", { hit_count: 0 }],
    ["đổi last_hit_at", { last_hit_at: serverTimestamp() }],
    ["đổi created_at", { created_at: serverTimestamp() }],
    ["version nhảy 2", { version: 4 }],
    ["giữ duyệt mà không ghi người duyệt", { approved_by: "kb-approve" }],
  ])("từ chối: %s", async (_name, over) => {
    const base = buildItemWrite(cur, { ...cur, answer: "Mới" }, ADMIN.email, serverTimestamp());
    await assertFails(upd({ ...base, ...over }));
  });

  it("không xóa được mục", async () => {
    await assertFails(deleteDoc(doc(admin(), "kb_items", "ky-so")));
  });
});

describe("unanswered", () => {
  const ref = () => doc(admin(), "unanswered", "u1");

  it("soạn đáp án mới: tạo mục và đánh dấu answered trong một lô", async () => {
    const db = admin();
    const b = writeBatch(db);
    b.set(doc(db, "kb_items", "nop-thue"), buildItemWrite(null, itemOf({ slug: "nop-thue" }), ADMIN.email, serverTimestamp()));
    b.update(doc(db, "unanswered", "u1"), {
      status: "answered", answered_slug: "nop-thue", answered_at: serverTimestamp(), handled_by: ADMIN.email,
    });
    await assertSucceeds(b.commit());
  });

  it("bỏ qua", async () => {
    await assertSucceeds(updateDoc(ref(), { status: "ignored", handled_by: ADMIN.email }));
  });

  it.each([
    ["sửa count", { status: "ignored", handled_by: ADMIN.email, count: 0 }],
    ["sửa câu mẫu", { status: "ignored", handled_by: ADMIN.email, samples: [] }],
    ["answered thiếu slug", { status: "answered", answered_at: serverTimestamp(), handled_by: ADMIN.email }],
    ["người xử lý giả", { status: "ignored", handled_by: "khac@example.com" }],
    ["trạng thái lạ", { status: "xong", handled_by: ADMIN.email }],
  ])("từ chối: %s", async (_name, data) => {
    await assertFails(updateDoc(ref(), data));
  });

  it("không tạo, không xóa", async () => {
    await assertFails(setDoc(doc(admin(), "unanswered", "u2"), { status: "new" }));
    await assertFails(deleteDoc(ref()));
  });
});

describe("D7: config/main chỉ ghi được các trường của màn Cài đặt", () => {
  const ref = () => doc(admin(), "config", "main");
  const stamp = { updated_at: serverTimestamp(), updated_by: ADMIN.email };

  it("dữ liệu do màn Cài đặt tạo được chấp nhận", async () => {
    const f = settingsFromConfig({ allowed_chat_ids: ["g1"] });
    f.ai_enabled = true;
    f.chats[0].label = "Nhóm thử";
    const { data } = validateSettings(f);
    await assertSucceeds(updateDoc(ref(), { ...data, ...stamp }));
  });

  it.each([
    ["ai_model", { ai_model: "claude-opus-5-5" }],
    ["monthly_message_limit", { monthly_message_limit: 999999 }],
    ["monthly_ai_call_limit", { monthly_ai_call_limit: 999999 }],
    ["bot_mention_name", { bot_mention_name: "khác" }],
    ["log_raw_body", { log_raw_body: true }],
    ["ngưỡng 1.5", { confidence_threshold: 1.5 }],
    ["ai_enabled kiểu chuỗi", { ai_enabled: "true" }],
    ["tin chuyển ca rỗng", { handoff_message: "" }],
    ["tin chuyển ca quá dài", { handoff_message: "x".repeat(1001) }],
  ])("từ chối: %s", async (_name, data) => {
    await assertFails(updateDoc(ref(), { ...data, ...stamp }));
  });

  it("thiếu dấu người sửa bị từ chối", async () => {
    await assertFails(updateDoc(ref(), { ai_enabled: true }));
    await assertFails(updateDoc(ref(), { ai_enabled: true, updated_at: serverTimestamp(), updated_by: "khac@example.com" }));
  });

  it("không tạo tài liệu config khác, không xóa config/main", async () => {
    await assertFails(setDoc(doc(admin(), "config", "khac"), { ai_enabled: true }));
    await assertFails(deleteDoc(ref()));
  });
});

// ---------- Bước E: ảnh ----------

const IMG = (i, over = {}) => ({
  url: `https://firebasestorage.googleapis.com/v0/b/demo/o/kb_images%2Fky-so%2F${i}.jpg?alt=media&token=t`,
  path: `kb_images/ky-so/${i}.jpg`, caption: "", width: 1600, height: 900, bytes: 200000, ...over,
});

describe("bước E: kb_items.images", () => {
  const upd = (data) => updateDoc(doc(admin(), "kb_items", "ky-so"), data);
  const cur = { ...ITEM };

  it("tạo mục có ảnh và sửa, đảo thứ tự, gỡ ảnh mục đã duyệt (version tăng) được chấp nhận", async () => {
    const item = validateItemForm(form({ slug: "co-anh", images: [] })).item;
    await assertSucceeds(setDoc(doc(admin(), "kb_items", "co-anh"),
      buildItemWrite(null, { ...item, images: [IMG(1)] }, ADMIN.email, serverTimestamp())));
    await assertSucceeds(upd(buildItemWrite(cur, { ...cur, images: [IMG(1), IMG(2)] }, ADMIN.email, serverTimestamp())));
  });

  it("10 ảnh được, 11 ảnh hoặc images không phải mảng bị từ chối", async () => {
    const base = buildItemWrite(cur, { ...cur, answer: "Mới" }, ADMIN.email, serverTimestamp());
    await assertSucceeds(upd({ ...base, images: Array.from({ length: 10 }, (_, i) => IMG(i)) }));
  });

  it.each([
    ["11 ảnh", { images: Array.from({ length: 11 }, (_, i) => IMG(i)) }],
    ["images là chuỗi", { images: "x" }],
    ["sửa image_urls cũ", { image_urls: ["https://x/1.jpg"] }],
  ])("từ chối: %s", async (_name, over) => {
    const base = buildItemWrite(cur, { ...cur, answer: "Mới" }, ADMIN.email, serverTimestamp());
    await assertFails(upd({ ...base, ...over }));
  });

  it("tạo mục mà image_urls không rỗng bị từ chối", async () => {
    const base = buildItemWrite(null, itemOf({ slug: "c2" }), ADMIN.email, serverTimestamp());
    await assertFails(setDoc(doc(admin(), "kb_items", "c2"), { ...base, image_urls: ["https://x/1.jpg"] }));
  });
});

describe("bước E: config/main.max_images_per_answer", () => {
  const ref = () => doc(admin(), "config", "main");
  const stamp = { updated_at: serverTimestamp(), updated_by: ADMIN.email };

  it("màn Cài đặt ghi 0 và 10 được", async () => {
    const f = settingsFromConfig({ allowed_chat_ids: ["g1"] });
    for (const v of ["0", "10"]) {
      const { data } = validateSettings({ ...f, max_images_per_answer: v });
      await assertSucceeds(updateDoc(ref(), { ...data, ...stamp }));
    }
  });

  it.each([[11], [-1], [2.5], ["4"]])("từ chối %o", async (v) => {
    await assertFails(updateDoc(ref(), { max_images_per_answer: v, ...stamp }));
  });
});

describe("E6: Storage kb_images", () => {
  const st = (ctx) => ctx.storage();
  const adminSt = () => st(env.authenticatedContext(ADMIN.uid, { email: ADMIN.email }));
  const outsiderSt = () => st(env.authenticatedContext("nguoi-ngoai", { email: "x@example.com" }));
  const anonSt = () => st(env.unauthenticatedContext());
  const bytes = (n) => new Uint8Array(n);
  const jpeg = { contentType: "image/jpeg" };

  it("admin tải ảnh JPEG lên thư mục của mục và lấy được download URL", async () => {
    const r = sref(adminSt(), "kb_images/ky-so/abc123.jpg");
    await assertSucceeds(uploadBytes(r, bytes(1000), jpeg));
    const url = await getDownloadURL(r);
    expect(url).toContain("token=");
  });

  it("PNG, WEBP và đúng 5 MB được nhận", async () => {
    await assertSucceeds(uploadBytes(sref(adminSt(), "kb_images/ky-so/a.png"), bytes(10), { contentType: "image/png" }));
    await assertSucceeds(uploadBytes(sref(adminSt(), "kb_images/ky-so/b.webp"), bytes(10), { contentType: "image/webp" }));
    await assertSucceeds(uploadBytes(sref(adminSt(), "kb_images/ky-so/c.jpg"), bytes(5 * 1024 * 1024), jpeg));
  });

  it("người ngoài admins và người chưa đăng nhập không tải lên, không đọc được", async () => {
    await assertFails(uploadBytes(sref(outsiderSt(), "kb_images/ky-so/x.jpg"), bytes(10), jpeg));
    await assertFails(uploadBytes(sref(anonSt(), "kb_images/ky-so/x.jpg"), bytes(10), jpeg));
    await assertSucceeds(uploadBytes(sref(adminSt(), "kb_images/ky-so/y.jpg"), bytes(10), jpeg));
    await assertFails(getDownloadURL(sref(outsiderSt(), "kb_images/ky-so/y.jpg")));
  });

  it.each([
    ["tệp không phải ảnh", "kb_images/ky-so/a.jpg", 10, { contentType: "application/pdf" }],
    ["ảnh GIF", "kb_images/ky-so/a.jpg", 10, { contentType: "image/gif" }],
    ["quá 5 MB", "kb_images/ky-so/a.jpg", 5 * 1024 * 1024 + 1, jpeg],
    ["ngoài thư mục kb_images", "khac/a.jpg", 10, jpeg],
    ["slug sai định dạng", "kb_images/Ky So/a.jpg", 10, jpeg],
    ["tên tệp lạ", "kb_images/ky-so/a.exe", 10, jpeg],
  ])("từ chối: %s", async (_name, path, n, meta) => {
    await assertFails(uploadBytes(sref(adminSt(), path), bytes(n), meta));
  });

  it("không ghi đè, không xóa, không liệt kê từ trình duyệt", async () => {
    const r = sref(adminSt(), "kb_images/ky-so/z.jpg");
    await assertSucceeds(uploadBytes(r, bytes(10), jpeg));
    await assertFails(uploadBytes(sref(adminSt(), "kb_images/ky-so/z.jpg"), bytes(20), jpeg));
    await assertFails(deleteObject(sref(adminSt(), "kb_images/ky-so/z.jpg")));
    await assertFails(listAll(sref(adminSt(), "kb_images/ky-so")));
  });
});
