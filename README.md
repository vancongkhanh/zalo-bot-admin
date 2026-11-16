# Bot TTHC Đảng: webhook giai đoạn 1

Backend nhận tin từ Zalo Bot qua webhook, chạy trên Firebase Cloud Functions (thế hệ 2, Node.js 24, vùng `asia-southeast1`).
Phạm vi giai đoạn 1: xác thực, chống trùng, chỉ trả lời nhóm được phép, trả lời cố định `Đã nhận: {câu hỏi}`, nhật ký và bộ đếm. Chưa có AI hay kho tri thức.

- Dự án Firebase: `zalo-bot-tthc-dang`
- Địa chỉ webhook: `https://asia-southeast1-zalo-bot-tthc-dang.cloudfunctions.net/zaloWebhook`

## Cấu trúc

```
firebase.json, .firebaserc, firestore.rules, firestore.indexes.json (TTL cho processed_events.expire_at)
functions/src/
  index.ts       hàm zaloWebhook: nối secrets, Firestore, logger vào luồng xử lý
  webhook.ts     luồng xử lý chính (spec mục 6)
  zaloClient.ts  sendMessage, sendPhoto (chưa dùng), setWebhook, deleteWebhook, getMe, getWebhookInfo
  mention.ts     cắt @tên bot
  security.ts    so sánh secret thời gian không đổi
  store.ts       Firestore: chống trùng, nhật ký, bộ đếm, cấu hình
  config.ts      secrets, đọc config/main, tháng theo giờ Việt Nam
functions/test/  kiểm thử đơn vị (vitest)
scripts/
  webhook-set.mjs     đăng ký webhook
  webhook-delete.mjs  xóa webhook (để quay lại getUpdates)
  check-bot.mjs       chẩn đoán: getMe + getWebhookInfo (chỉ đọc)
  send-sample.mjs     gửi sự kiện mẫu tới hàm để thử, in mã HTTP và thời gian
  sample-event.json   sự kiện mẫu (toàn giá trị giả)
  test-photo.mjs      thử sendPhoto (ngoài phạm vi giai đoạn 1)
  kb/                 script kho tri thức và đo chất lượng (bước B, C), xem scripts/kb/README.md
admin/
  index.html          trang quản trị (bước D), một tệp, đưa lên GitHub Pages; xem admin/README.md
  test/               kiểm thử logic của trang và quy tắc Firestore (emulator)
```

## Bí mật

Không bao giờ ghi token, secret hay mã nhóm thật vào mã nguồn hoặc Git.

| Tên | Lưu ở | Ghi chú |
|---|---|---|
| `ZALO_BOT_TOKEN` | Firebase secret | Token bot |
| `ZALO_WEBHOOK_SECRET` | Firebase secret | 8-256 ký tự, **chỉ `A-Z a-z 0-9 _ -`** (Zalo từ chối ký tự khác) |
| `ANTHROPIC_API_KEY` | Firebase secret | Khóa Anthropic (bước C). **Phải đặt trước khi triển khai** bản có bước C, kể cả khi `ai_enabled` tắt |
| Mã nhóm | Firestore `config/main` | Không ghi vào mã |

Đặt hoặc đổi secret (gõ giá trị tại dấu nhắc; dán bằng chuột phải trong cmd):

```
firebase functions:secrets:set ZALO_BOT_TOKEN
firebase functions:secrets:set ZALO_WEBHOOK_SECRET
firebase functions:secrets:set ANTHROPIC_API_KEY
```

Tạo secret ngẫu nhiên hợp lệ: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

Sau khi đổi secret phải **triển khai lại** (`firebase deploy --only functions`), vì hàm gắn với một phiên bản secret cụ thể. Đổi `ZALO_WEBHOOK_SECRET` thì chạy lại `webhook-set` với giá trị mới.

## Cấu hình `config/main` (Firestore)

| Trường | Kiểu | Ý nghĩa |
|---|---|---|
| `allowed_chat_ids` | array chuỗi | Mã nhóm được phép (`zgr-...`). Nhiều nhóm được; gói Basic cho tối đa 3 nhóm |
| `bot_mention_name` | string | `Bot TTHC Đảng` |
| `monthly_message_limit` | number | `3000` |
| `reply_enabled` | boolean | `false` để tạm tắt trả lời, vẫn ghi nhật ký |
| `log_raw_body` | boolean | `true`: ghi thân yêu cầu (đã che nội dung, tên, mã người dùng) ra Cloud Logging. Tắt khi không cần |
| `ai_enabled` | boolean | Bước C. Mặc định `false`: trả lời như giai đoạn 1 ("Đã nhận: ...") |
| `ai_model` | string | Mặc định `claude-haiku-5-5` |
| `confidence_threshold` | number 0-1 | Mặc định `0.7`. Dưới ngưỡng thì chuyển ca |
| `monthly_ai_call_limit` | number | Mặc định `6000`. Hết hạn mức: không gọi AI, gửi tin mẫu |
| `handoff_message` | string | Tin chuyển ca (tối đa 1.000 ký tự) |
| `ai_timeout_ms` | number | Mặc định `15000`, cho phép 1.000-50.000 |

Giá trị sai kiểu hoặc ngoài khoảng: hàm dùng mặc định và ghi cảnh báo "Cấu hình config/main".

Hàm đọc lại cấu hình ở mỗi yêu cầu: sửa trong Console là có hiệu lực ngay.

## Dữ liệu ghi ra

| Nơi | Nội dung |
|---|---|
| `processed_events/{message_id}` | `received_at`, `state` (`processing`/`done`/`failed`), `expire_at` (+7 ngày, TTL tự xóa) |
| `conversations/{message_id}` | `chat_id`, `from_id`, `display_name`, `question`, `reply_text`, `outcome` (`replied`/`ignored`/`error`/`answered`/`handoff`), `ignore_reason`, `error`, `duration_ms`, `created_at`, `expire_at` (+90 ngày, TTL). Bước C thêm `matched_slug`, `confidence`, `reason` (`no_match`/`low_confidence`/`ai_error`/`ai_quota`), `ai_ms`, `send_ok` |
| `usage/{YYYY-MM}` | `messages_sent` (đếm mọi lần gọi `sendMessage`, kể cả lỗi), `send_errors`, `quota_warning_sent`, `ai_calls`, `ai_errors`, `ai_input_tokens`, `ai_output_tokens` (tháng theo giờ Việt Nam) |
| `stats_daily/{YYYY-MM-DD}` | Bước C: `questions`, `answered`, `handoff`, `ai_errors`, `item_hits.{slug}` (ngày theo giờ Việt Nam) |
| `unanswered/{id}` | Bước C: câu chuyển ca gộp theo câu đã chuẩn hóa. `cluster_key`, `samples` (≤ 3), `count`, `first_asked_at`, `last_asked_at`, `reason`, `best_guess_slug`, `best_guess_confidence`, `status` (`new`/`answered`/`ignored`), `answered_slug`, `answered_at`. Không lưu mã người dùng |
| `kb_items/{slug}` | Bước C tăng `hit_count`, cập nhật `last_hit_at` khi bot trả lời bằng mục |

`ignore_reason`: `unsupported_event:<event_name>`, `not_group:<chat_type>`, `no_mention`, `reply_disabled`, `quota`.
Nhóm không có trong danh sách: không ghi `conversations`, chỉ ghi dòng Cloud Logging "Nhóm không được phép" kèm `chat_id`.

## Phát triển và kiểm thử

```
cd functions
npm install
npm run build
npm test
```

## Triển khai

```
firebase deploy --only functions,firestore
```

Từ bước D, `firestore.rules` cho phép tài khoản có trong `admins/{uid}` đọc/ghi qua trang quản trị. Muốn triển khai riêng hàm mà chưa mở quy tắc mới: `firebase deploy --only functions`. Chỉ triển khai quy tắc và chỉ mục: `firebase deploy --only firestore`.

## Đăng ký webhook

```
npm --prefix functions run build
node scripts/check-bot.mjs      # kiểm tra token (getMe) và webhook hiện tại
node scripts/webhook-set.mjs    # đăng ký; phản hồi có verification.outcome = webhook.ok là đạt
node scripts/webhook-delete.mjs # xóa, khi cần quay lại getUpdates
```

Script đọc `ZALO_BOT_TOKEN`, `ZALO_WEBHOOK_SECRET`, `ZALO_WEBHOOK_URL` từ biến môi trường; nếu không có thì hỏi (bí mật được hỏi ẩn ký tự). Script in "dấu vân tay" (độ dài + 8 ký tự đầu SHA-256) để đối chiếu mà không lộ giá trị, và từ chối chuỗi có ký tự điều khiển (thường do Ctrl+V không dán được trong cmd).

## Thử nhanh bằng sự kiện mẫu

```
node scripts/send-sample.mjs --get            # mong đợi 405
node scripts/send-sample.mjs --no-secret      # mong đợi 401
node scripts/send-sample.mjs --wrong-secret   # mong đợi 401
node scripts/send-sample.mjs                  # 200; nhóm giả nên chỉ ghi "Nhóm không được phép"
node scripts/send-sample.mjs --id X; node scripts/send-sample.mjs --id X   # lần 2 là "Sự kiện trùng"
```

Cảnh báo: dùng `--chat` với mã nhóm có trong `allowed_chat_ids` thì bot gửi tin **thật** vào nhóm (trừ khi `--id` đã được xử lý).

## Xem nhật ký

```
firebase functions:log --only zaloWebhook
```

Hoặc Firebase Console, Functions, Logs. Các dòng đáng chú ý: "Nhóm không được phép" (lấy mã nhóm), "Sự kiện trùng", "Đã xử lý sự kiện" (có `duration_ms`), "Đã dùng 80% hạn mức", "Gửi tin thất bại".

## Điều khác với tài liệu Zalo đã gặp

- `secret_token` chỉ nhận `A-Z a-z 0-9 _ -` (tài liệu chỉ nêu độ dài 8-256).
- `getWebhookInfo` trả `error_code 404 "Not Found"` khi chưa đăng ký webhook.
- `setWebhook` thành công trả `updated_at: 0`.
- Sau `setWebhook`, Zalo gửi yêu cầu thử `event_name: "webhook.test"`, `message_id: "webhook-test"`, không có `chat`/`from`, `date` tính bằng giây. Hàm bỏ qua và trả 200.
- Lỗi API trả HTTP 200 kèm `ok: false`, `error_code`, `description`.
