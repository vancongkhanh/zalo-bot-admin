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
  for (let n = 0; n < 10; n++) {
    const q = 3 + ((n * 7) % 5);
    await setDoc(doc(db, "stats_daily", day(n)), {
      questions: q, answered: q - 2, handoff: 2, ai_errors: n % 4 === 0 ? 1 : 0,
      item_hits: { "ky-so": q - 3, "cau-hinh-chu-ky": 1 },
    });
  }
  const month = day(0).slice(0, 7);
  await setDoc(doc(db, "usage", month), {
    messages_sent: 2510, send_errors: 3, ai_calls: 120, ai_errors: 2, ai_input_tokens: 150000, ai_output_tokens: 3000,
  });
  await setDoc(doc(db, "config", "main"), {
    allowed_chat_ids: ["nhom-gia-1", "nhom-gia-2"], chat_labels: { "nhom-gia-1": "Nhóm thử" },
    bot_mention_name: "Bot TTHC Đảng", monthly_message_limit: 3000, reply_enabled: true, ai_enabled: false,
    ai_model: "claude-haiku-5-5", confidence_threshold: 0.7, monthly_ai_call_limit: 6000,
  });
});
await env.cleanup();
console.log(uid ? `Đã nạp dữ liệu giả và cấp quyền admin cho ${uid}.` : "Đã nạp dữ liệu giả (chưa cấp admin).");
