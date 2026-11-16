// Thử sendPhoto (NGOÀI phạm vi giai đoạn 1: viết sẵn, chỉ chạy khi bạn muốn xác minh).
// Lưu ý: mỗi lần chạy thành công có thể tính vào hạn mức 3.000 tin/tháng.
// ZALO_BOT_TOKEN: biến môi trường hoặc hỏi ẩn.
// Tham số: node scripts/test-photo.mjs <chat_id> [photo_url] [caption]
import { fail, getSecret, loadZaloClient, printResult, prompt } from "./lib.mjs";

const { createZaloClient } = loadZaloClient();
const chatId = process.argv[2] || (await prompt("Mã nhóm (zgr-...)"));
if (!chatId) fail("Thiếu chat_id");
const photo = process.argv[3] || "https://placehold.co/600x400.png";
const caption = process.argv[4] || "Thu sendPhoto";

const token = await getSecret("ZALO_BOT_TOKEN", "Token bot");
console.log(`sendPhoto tới ${chatId}: ${photo}`);
const result = await createZaloClient({ token, baseUrl: process.env.ZALO_API_BASE || undefined }).sendPhoto(chatId, photo, caption);
printResult("sendPhoto", result, [token]);
