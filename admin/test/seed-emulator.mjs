// Nạp dữ liệu GIẢ vào Firestore Emulator (dự án demo-zalo-bot) để thử trang quản trị.
// Không bao giờ chạm dự án thật: chỉ kết nối 127.0.0.1:8080 với projectId demo.
// Cách dùng (khi emulator đang chạy):  node test/seed-emulator.mjs [uid-admin]
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, Timestamp } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "demo-zalo-bot",
  firestore: { host: "127.0.0.1", port: 8080 },
});
const uid = process.argv[2];
const ago = (h) => Timestamp.fromMillis(Date.now() - h * 3600_000);
const day = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(Date.now() - n * 86400_000));

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  if (uid) await setDoc(doc(db, "admins", uid), { email: "admin@example.com" });
  const item = (title, topic, questions, status, hits) => ({
    title, topic, questions, answer: `Hướng dẫn mẫu cho "${title}".`, links: [], keywords: [], source: "Tài liệu mẫu",
    status, steps: [], image_urls: [], hit_count: hits, last_hit_at: hits ? ago(5) : null, version: 1,
    created_at: ago(200), updated_at: ago(100), approved_at: status === "approved" ? ago(100) : null,
    approved_by: status === "approved" ? "kb-approve" : null,
  });
  await setDoc(doc(db, "kb_items", "ky-so"), item("Cài đặt chữ ký số", "Chữ ký", ["cài chữ ký số", "video cài ký số"], "approved", 12));
  await setDoc(doc(db, "kb_items", "cau-hinh-chu-ky"), item("Cấu hình chữ ký và con dấu", "Chữ ký", ["cấu hình ký số", "cấu hình con dấu"], "approved", 4));
  await setDoc(doc(db, "kb_items", "doi-mat-khau"), item("Đổi mật khẩu", "Tài khoản", ["đổi mật khẩu"], "draft", 0));
  const un = (id, samples, count, reason, guess, conf) => setDoc(doc(db, "unanswered", id), {
    cluster_key: id, samples, count, reason, best_guess_slug: guess, best_guess_confidence: conf,
    status: "new", first_asked_at: ago(48), last_asked_at: ago(count),
  });
  await un("u1", ["Nộp thuế ở đâu ạ?", "nop thue o dau"], 5, "no_match", null, null);
  await un("u2", ["Chữ ký bị lỗi không ký được <b>gấp</b>"], 3, "low_confidence", "ky-so", 0.55);
  await un("u3", ["Quên mật khẩu đăng nhập thì làm sao?"], 1, "ai_error", null, null);
  // Bước F: câu hỏi bằng ảnh (ảnh không lưu, chỉ có mô tả do AI viết).
  await setDoc(doc(db, "unanswered", "img_u4"), {
    cluster_key: "", samples: ["[Ảnh] Màn hình kết xuất báo cáo báo lỗi thiếu mẫu"], count: 1, reason: "no_match",
    best_guess_slug: null, best_guess_confidence: null, status: "new", first_asked_at: ago(2), last_asked_at: ago(2),
    source: "image", image_summary: "Màn hình kết xuất báo cáo báo lỗi thiếu mẫu",
  });
  // Trả lời người hỏi: lượt hỏi giả của u1 (u2, u3 là câu cũ, không có pending_ask_count).
  const askDoc = (uId, id, chatId, name, question, h, extra = {}) => setDoc(doc(db, "unanswered", uId, "asks", id), {
    chat_id: chatId, chat_type: "GROUP", from_id: `nguoi-${name}`, display_name: name, question, message_id: id,
    asked_at: ago(h), reply_status: "pending", replied_at: null, reply_error: null, reply_batch_id: null,
    expire_at: ago(-2000), ...extra,
  });
  await setDoc(doc(db, "unanswered", "u1"), { pending_ask_count: 4 }, { merge: true });
  await askDoc("u1", "a1", "nhom-gia-1", "Chị Lan", "Nộp thuế ở đâu ạ?", 5);
  await askDoc("u1", "a2", "nhom-gia-1", "Anh Minh", "nop thue o dau", 1);
  await askDoc("u1", "a3", "nhom-gia-2", "Cô Hoa", "Cho hỏi nộp thuế ở đâu", 3, { reply_status: "failed", reply_error: "timeout: sendMessage: quá 10000 ms" });
  await askDoc("u1", "a4", "nhom-gia-loi", "Bác Tư", "nộp thuế chỗ nào", 100);
  // Mục 6.4: đã có đáp án nhưng còn một người chưa được trả lời.
  await setDoc(doc(db, "unanswered", "u5"), {
    cluster_key: "cai chu ky so", samples: ["Cài chữ ký số kiểu gì?"], count: 2, reason: "no_match",
    best_guess_slug: null, best_guess_confidence: null, status: "answered", answered_slug: "ky-so",
    answered_at: ago(1), first_asked_at: ago(3), last_asked_at: ago(1), pending_ask_count: 1,
  });
  await askDoc("u5", "b1", "nhom-gia-2", "Chú Ba", "Cài chữ ký số kiểu gì?", 1);
  await askDoc("u5", "b2", "nhom-gia-1", "Chị Lan", "cài chữ ký số", 2, { reply_status: "sent" });
  // Bước G: lịch sử hỗ trợ (dữ liệu giả hoàn toàn).
  const conv = (id, h, o) => setDoc(doc(db, "conversations", id), {
    chat_id: "nhom-gia-1", from_id: "nguoi-gia", display_name: "Người Thử", reply_text: null, ignore_reason: null,
    error: null, duration_ms: 1200, created_at: ago(h), expire_at: ago(-2000), ...o,
  });
  await conv("c1", 1, {
    question: "cài chữ ký số thế nào <b>gấp</b>", outcome: "answered", matched_slug: "ky-so", confidence: 0.93,
    reason: null, ai_ms: 900, send_ok: true, reply_text: "Hướng dẫn mẫu cho \"Cài đặt chữ ký số\".\n\nVideo: https://youtu.be/fake",
    images_sent: 2, image_errors: 0, images_as_links: 1,
  });
  await conv("c2", 3, {
    question: "nộp thuế ở đâu, gọi em 0912 345 678", outcome: "handoff", matched_slug: null, confidence: 0.4,
    reason: "no_match", ai_ms: 800, send_ok: true, reply_text: "Câu hỏi của anh/chị đã được ghi nhận, chuyên viên sẽ hỗ trợ sớm.",
    display_name: "Chị Lan", chat_id: "nhom-gia-2",
  });
  await conv("c3", 5, {
    question: "lỗi này là sao", outcome: "answered", matched_slug: "cau-hinh-chu-ky", confidence: 0.81, reason: null,
    ai_ms: 2100, send_ok: true, reply_text: "Hướng dẫn mẫu cho \"Cấu hình chữ ký và con dấu\".",
    source: "image", image_bytes: 245000, image_type: "image/png", fetch_ms: 310,
    image_summary: "Màn hình cấu hình con dấu báo thiếu ảnh dấu",
    // Bước G2: link ảnh giả (ảnh công khai bất kỳ) để thử hiện ảnh.
    photo_url: "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png",
    image_text: "Cấu hình chữ ký\nĐơn vị: ⟦UBND xã Mẫu⟧\nNgười ký: ⟦Nguyễn Văn A⟧ - ĐT ⟦0987 654 321⟧\nLỗi: Chưa tải ảnh con dấu (mã E-102)",
  });
  await conv("c4", 8, {
    question: "", outcome: "handoff", reason: "image_fetch_error", send_ok: true, source: "image",
    reply_text: "Câu hỏi của anh/chị đã được ghi nhận, chuyên viên sẽ hỗ trợ sớm.", fetch_ms: 10000,
    image_bytes: null, image_type: null, image_summary: null, image_text: null,
    photo_url: "https://photo-zalo.example/het-han.jpg",
  });
  await conv("c5", 20, {
    question: "tin có ảnh", outcome: "ignored", ignore_reason: "image_ai_disabled", source: "image",
  });
  await conv("c6", 30, {
    question: "đổi mật khẩu", outcome: "answered", matched_slug: "doi-mat-khau", confidence: 0.9, send_ok: false,
    error: "send_failed:500", reply_text: "Hướng dẫn mẫu cho \"Đổi mật khẩu\".",
  });
  await conv("c7", 2, { question: "hai người nói chuyện riêng", outcome: "ignored", ignore_reason: "no_mention" });
  // Thêm câu gợi ý từ Lịch sử: có số điện thoại (phải xóa mới lưu), mục còn Nháp (không có nút),
  // đã thêm (nhãn ✓), câu đang là gợi ý của mục khác (cảnh báo đỏ).
  await conv("c8", 4, {
    question: "cài ký số trên máy mới, gọi em 0912 345 678", outcome: "answered", matched_slug: "ky-so",
    confidence: 0.78, reason: null, send_ok: true, reply_text: "Hướng dẫn mẫu cho \"Cài đặt chữ ký số\".",
  });
  await conv("c9", 6, {
    question: "đổi mật khẩu đăng nhập", outcome: "answered", matched_slug: "doi-mat-khau", confidence: 0.92,
    reason: null, send_ok: true, reply_text: "Hướng dẫn mẫu cho \"Đổi mật khẩu\".",
  });
  await conv("c10", 7, {
    question: "video cài chữ ký số", outcome: "answered", matched_slug: "ky-so", confidence: 0.95, reason: null,
    send_ok: true, reply_text: "Hướng dẫn mẫu cho \"Cài đặt chữ ký số\".",
    suggestion_added_at: ago(6), suggestion_kb_item_id: "ky-so",
  });
  await conv("c11", 9, {
    question: "Cấu hình con dấu?", outcome: "answered", matched_slug: "ky-so", confidence: 0.6, reason: null,
    send_ok: true, reply_text: "Hướng dẫn mẫu cho \"Cài đặt chữ ký số\".",
  });
  // Bước 6: tin admin gửi từ trang quản trị (Trả lời người hỏi).
  await conv("admin_reply_batch-gia_1", 0.5, {
    outcome: "admin_reply", from_id: null, display_name: null, chat_type: "GROUP", question: "cài chữ ký số",
    reply_text: "📌 Trả lời câu hỏi của Chị Lan (09:00 25/11):\n\"cài chữ ký số\"\n\nHướng dẫn mẫu cho \"Cài đặt chữ ký số\".",
    matched_slug: "ky-so", send_ok: true, duration_ms: 420, admin_batch_id: "batch-gia", unanswered_id: "u5",
    ask_ids: ["b2"], reply_to_names: ["Chị Lan"], sent_by: "admin@example.com",
  });
  for (let n = 0; n < 10; n++) {
    const q = 3 + ((n * 7) % 5);
    await setDoc(doc(db, "stats_daily", day(n)), {
      questions: q, answered: q - 2, handoff: 2, ai_errors: n % 4 === 0 ? 1 : 0,
      item_hits: { "ky-so": q - 3, "cau-hinh-chu-ky": 1 },
      image_questions: n % 3 === 0 ? 1 : 0,
    });
  }
  const month = day(0).slice(0, 7);
  await setDoc(doc(db, "usage", month), {
    messages_sent: 2510, send_errors: 3, ai_calls: 120, ai_errors: 2, ai_input_tokens: 150000, ai_output_tokens: 3000,
    image_ai_calls: 4, image_ai_errors: 0, image_input_tokens: 24000, image_output_tokens: 900, image_fetch_errors: 1,
  });
  await setDoc(doc(db, "config", "main"), {
    allowed_chat_ids: ["nhom-gia-1", "nhom-gia-2"], chat_labels: { "nhom-gia-1": "Nhóm thử" },
    bot_mention_name: "Bot TTHC Đảng", monthly_message_limit: 3000, reply_enabled: true, ai_enabled: false,
    ai_model: "claude-haiku-5-5", confidence_threshold: 0.7, monthly_ai_call_limit: 6000,
  });
});
await env.cleanup();
console.log(uid ? `Đã nạp dữ liệu giả và cấp quyền admin cho ${uid}.` : "Đã nạp dữ liệu giả (chưa cấp admin).");
