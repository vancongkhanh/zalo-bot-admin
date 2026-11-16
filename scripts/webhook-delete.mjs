// Xóa webhook (cần khi muốn quay lại dùng getUpdates).
// ZALO_BOT_TOKEN đọc từ biến môi trường, nếu không có thì hỏi ẩn.
// Chạy: npm --prefix functions run build  rồi  node scripts/webhook-delete.mjs
import { getSecret, loadZaloClient, printResult } from "./lib.mjs";

const { createZaloClient } = loadZaloClient();
const token = await getSecret("ZALO_BOT_TOKEN", "Token bot");
const result = await createZaloClient({ token, baseUrl: process.env.ZALO_API_BASE || undefined }).deleteWebhook();
printResult("deleteWebhook", result, [token]);
