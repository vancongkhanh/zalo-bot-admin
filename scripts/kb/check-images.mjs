// Chỉ đọc: các lần trả lời có ảnh gần nhất và bộ đếm tháng (bước E, E3/E10).
// Không in nội dung câu hỏi, mã người dùng hay mã nhóm.
// Cách dùng: node scripts/kb/check-images.mjs [số lần, mặc định 5]
import { getDb, explainAuthError } from "./lib/db.mjs";

const n = Number(process.argv[2] ?? 5);
try {
  const db = getDb();
  const snap = await db.collection("conversations").orderBy("created_at", "desc").limit(50).get();
  const rows = snap.docs
    .map((d) => d.data())
    .filter((d) => typeof d.images_sent === "number")
    .slice(0, n);
  console.log(`Lần trả lời có ảnh gần nhất (${rows.length}):`);
  for (const d of rows) {
    console.log(
      `  ${d.created_at?.toDate?.().toISOString() ?? "?"}  mục=${d.matched_slug}  gửi=${d.images_sent}` +
        `  lỗi=${d.image_errors}  thành link=${d.images_as_links}  send_ok=${d.send_ok}  duration_ms=${d.duration_ms}  ai_ms=${d.ai_ms}`,
    );
  }
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" })
    .format(new Date())
    .slice(0, 7);
  const u = (await db.collection("usage").doc(month).get()).data() ?? {};
  console.log(`usage/${month}: messages_sent=${u.messages_sent ?? 0} photos_sent=${u.photos_sent ?? 0} photo_errors=${u.photo_errors ?? 0} send_errors=${u.send_errors ?? 0}`);
} catch (e) {
  console.error(explainAuthError(e));
  process.exit(1);
}
