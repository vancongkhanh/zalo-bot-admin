// Đăng ký webhook với Zalo.
// Đọc từ biến môi trường (nếu có), nếu không thì hỏi:
//   ZALO_BOT_TOKEN       (hỏi ẩn)
//   ZALO_WEBHOOK_SECRET  (hỏi ẩn; phải trùng secret đã đặt bằng firebase functions:secrets:set;
//                         8-256 ký tự, chỉ A-Z, a-z, 0-9, _ và -)
//   ZALO_WEBHOOK_URL     (mặc định: địa chỉ hàm zaloWebhook suy từ .firebaserc)
// Chạy: npm --prefix functions run build  rồi  node scripts/webhook-set.mjs
// Nếu đang dùng getUpdates, chạy webhook-delete.mjs trước.
import { defaultWebhookUrl, fail, getSecret, loadZaloClient, printResult, prompt } from "./lib.mjs";

const { createZaloClient } = loadZaloClient();

const url = process.env.ZALO_WEBHOOK_URL?.trim() || (await prompt("Địa chỉ webhook", defaultWebhookUrl()));
if (!/^https:\/\//i.test(url)) fail("Địa chỉ webhook phải là HTTPS");

const token = await getSecret("ZALO_BOT_TOKEN", "Token bot");
const secret = await getSecret("ZALO_WEBHOOK_SECRET", "Webhook secret");
if (!/^[A-Za-z0-9_-]{8,256}$/.test(secret)) {
  fail("Webhook secret phải dài 8-256 ký tự, chỉ gồm A-Z, a-z, 0-9, _ và - (quy tắc thực tế của Zalo)");
}

console.log(`Đăng ký webhook: ${url}`);
const client = createZaloClient({ token, baseUrl: process.env.ZALO_API_BASE || undefined });
const result = await client.setWebhook(url, secret);
printResult("setWebhook", result, [token, secret]);
