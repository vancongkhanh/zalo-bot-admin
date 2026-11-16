// Gửi sự kiện mẫu (sample-event.json) tới hàm webhook để thử logic, vì Zalo
// không gọi được trình giả lập. In mã HTTP và thời gian phản hồi.
//
// Tùy chọn:
//   --id <message_id>    mặc định: ngẫu nhiên (gửi 2 lần cùng --id để thử chống trùng)
//   --chat <chat_id>     mặc định: mã nhóm giả trong tệp mẫu (không có trong allowed_chat_ids)
//   --text "<nội dung>"  mặc định: nội dung trong tệp mẫu
//   --event <tên>        ví dụ message.image.received
//   --type <chat_type>   ví dụ PRIVATE
//   --no-secret          không gửi header (phải nhận 401)
//   --wrong-secret       gửi header sai (phải nhận 401)
//   --get                gửi GET (phải nhận 405)
//   --url <địa chỉ>      mặc định: ZALO_WEBHOOK_URL hoặc suy từ .firebaserc
// ZALO_WEBHOOK_SECRET: biến môi trường hoặc hỏi ẩn.
//
// CẢNH BÁO: nếu --chat là nhóm có trong allowed_chat_ids, bot sẽ gửi tin THẬT vào nhóm đó.
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { ROOT, defaultWebhookUrl, fail, getSecret } from "./lib.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const url = opt("--url") || process.env.ZALO_WEBHOOK_URL?.trim() || defaultWebhookUrl();
if (!url) fail("Không xác định được địa chỉ webhook; dùng --url");

const event = JSON.parse(readFileSync(join(ROOT, "scripts", "sample-event.json"), "utf8"));
event.message.message_id = opt("--id") || `test-${randomBytes(8).toString("hex")}`;
event.message.date = Date.now();
if (opt("--chat")) event.message.chat.id = opt("--chat");
if (opt("--text")) event.message.text = opt("--text");
if (opt("--event")) event.event_name = opt("--event");
if (opt("--type")) event.message.chat.chat_type = opt("--type");

const headers = { "Content-Type": "application/json" };
if (flag("--wrong-secret")) headers["X-Bot-Api-Secret-Token"] = "sai-secret-" + randomBytes(4).toString("hex");
else if (!flag("--no-secret") && !flag("--get")) {
  headers["X-Bot-Api-Secret-Token"] = await getSecret("ZALO_WEBHOOK_SECRET", "Webhook secret");
}

const method = flag("--get") ? "GET" : "POST";
console.log(`${method} ${url}`);
if (method === "POST") {
  console.log(`message_id=${event.message.message_id} chat=${event.message.chat.id} event=${event.event_name}`);
}
const started = performance.now();
const res = await fetch(url, {
  method,
  headers,
  body: method === "POST" ? JSON.stringify(event) : undefined,
  signal: AbortSignal.timeout(70_000),
});
const body = await res.text();
const ms = Math.round(performance.now() - started);
console.log(`HTTP ${res.status} "${body.slice(0, 100)}" trong ${ms} ms`);
