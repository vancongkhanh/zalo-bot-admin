// Chẩn đoán: kiểm tra token (getMe) và webhook đang đăng ký (getWebhookInfo).
// Chỉ đọc, không thay đổi gì, không gửi tin.
// ZALO_BOT_TOKEN: biến môi trường hoặc hỏi ẩn.
// Chạy: npm --prefix functions run build  rồi  node scripts/check-bot.mjs
import { getSecret, loadZaloClient, printResult } from "./lib.mjs";

const { createZaloClient } = loadZaloClient();
const token = await getSecret("ZALO_BOT_TOKEN", "Token bot");
const client = createZaloClient({ token, baseUrl: process.env.ZALO_API_BASE || undefined });
printResult("getMe", await client.getMe(), [token]);
printResult("getWebhookInfo", await client.getWebhookInfo(), [token]);
