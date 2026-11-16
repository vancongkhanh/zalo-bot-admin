# Spec giai đoạn 1: Webhook cơ bản cho Bot TTHC Đảng

Dành cho Claude Code. Ngày: 16/11/2026. Đọc kèm `zalo-bot-ke-hoach-thuc-hien.md` (mục 3 và 4 có thông tin Zalo Bot đã xác nhận). Spec này cần bạn duyệt trước khi giao.

## 1. Mục tiêu và phạm vi

Dựng backend nhận tin từ Zalo qua webhook, kiểm tra an toàn, chống xử lý trùng, chỉ trả lời trong nhóm được phép, và trả lời cố định để chứng minh vòng nhận gửi chạy ổn định. Chưa có AI, chưa có kho tri thức.

| Trong phạm vi | Ngoài phạm vi (làm ở giai đoạn sau) |
|---|---|
| Hàm webhook trên Firebase Cloud Functions | AI, kho tri thức, trang quản trị |
| Xác thực header `X-Bot-Api-Secret-Token` | Xử lý ảnh người dùng gửi (chỉ ghi nhật ký và bỏ qua) |
| Chống xử lý trùng theo `message_id` | Gửi ảnh (`sendPhoto`): chỉ viết sẵn hàm, chưa dùng |
| Chỉ xử lý nhóm có trong danh sách cho phép, có @bot | Chat riêng (PRIVATE): bỏ qua |
| Cắt phần @tên bot, trả lời cố định bằng `sendMessage` | Thống kê, giao diện |
| Nhật ký hội thoại và bộ đếm tin gửi trong Firestore | |
| Script đăng ký, xóa webhook | |

## 2. Quyết định kỹ thuật

| Hạng mục | Quyết định |
|---|---|
| Dự án Firebase | Dự án mới (bạn đã tạo hoặc sẽ tạo), gói Blaze, đã đặt cảnh báo ngân sách |
| Ngôn ngữ | Node.js; **đề xuất TypeScript** (đổi sang JavaScript nếu bạn muốn đơn giản hơn) |
| Cloud Functions | Thế hệ 2, vùng `asia-southeast1`, dùng phiên bản Node LTS mà Firebase đang hỗ trợ (Claude Code kiểm tra khi khởi tạo) |
| Gọi HTTP | `fetch` có sẵn của Node 18 trở lên, không cần thư viện thêm |
| Bí mật | `ZALO_BOT_TOKEN`, `ZALO_WEBHOOK_SECRET` lưu bằng Firebase secrets; **token đã được đặt lại**, không ghi vào mã nguồn, tệp `.env` hay nhật ký |
| Tên bot | `Bot TTHC Đảng` (dùng để cắt phần @) |
| Firestore | Chỉ Cloud Functions (Admin SDK) đọc và ghi; quy tắc client từ chối mọi thứ ở giai đoạn này |

## 3. Cấu trúc thư mục đề xuất

```
zalo-bot/
  firebase.json, .firebaserc, firestore.rules
  functions/
    package.json, tsconfig.json
    src/
      index.ts            # xuất hàm zaloWebhook
      webhook.ts          # luồng xử lý chính
      zaloClient.ts       # sendMessage, sendPhoto (chưa dùng), setWebhook, deleteWebhook
      mention.ts          # cắt phần @tên bot
      security.ts         # so sánh secret an toàn
      store.ts            # Firestore: chống trùng, nhật ký, bộ đếm, cấu hình
      config.ts           # đọc secrets và cấu hình
    test/                 # kiểm thử đơn vị
  scripts/
    webhook-set.mjs, webhook-delete.mjs, test-photo.mjs
  README.md               # cách triển khai, cách thử
```

## 4. Cấu hình trong Firestore

Tài liệu `config/main`, bạn tự điền sau khi biết mã nhóm.

| Trường | Giá trị | Ghi chú |
|---|---|---|
| `allowed_chat_ids` | mảng chuỗi, ví dụ `["zgr-..."]` | Mã nhóm lấy từ nhật ký (mục 6, bước 4) |
| `bot_mention_name` | `Bot TTHC Đảng` | |
| `monthly_message_limit` | `3000` | Hạn mức gói Basic |
| `reply_enabled` | `true` | Đặt `false` để tạm tắt trả lời mà vẫn ghi nhật ký |

## 5. Dữ liệu ghi vào Firestore

| Bộ sưu tập / tài liệu | Nội dung | Ghi chú |
|---|---|---|
| `processed_events/{message_id}` | `received_at`, `state` (`processing`, `done`, `failed`), `expire_at` (7 ngày) | Dùng để chống trùng. Đặt chính sách TTL cho trường `expire_at` |
| `conversations/{message_id}` | `chat_id`, `from_id`, `display_name`, `question` (sau khi cắt @), `reply_text`, `outcome` (`replied`, `ignored`, `error`), `ignore_reason`, `duration_ms`, `created_at` | Không lưu token hay header |
| `usage/{YYYY-MM}` | `messages_sent` (tăng khi `sendMessage` thành công), `send_errors` | Dùng `FieldValue.increment` |

## 6. Luồng xử lý của `zaloWebhook`

Hàm HTTP nhận POST. Thân yêu cầu theo tài liệu có cùng cấu trúc với `result` của `getUpdates`, tức là `{ "event_name": "...", "message": { ... } }`. **Chưa xác minh** thân webhook có bọc thêm `result` không: hàm chấp nhận cả hai dạng (`body.result ?? body`) và ghi lại thân thô của vài yêu cầu đầu tiên (đã che thông tin cá nhân) để kiểm chứng.

1. **Chỉ nhận POST.** Phương thức khác trả 405.
2. **Xác thực.** So sánh header `X-Bot-Api-Secret-Token` với `ZALO_WEBHOOK_SECRET` bằng cách so sánh thời gian không đổi. Sai hoặc thiếu thì trả 401, không xử lý gì thêm và không ghi nhật ký nội dung.
3. **Phân loại sự kiện.** Chỉ xử lý `event_name = message.text.received` với `message.chat.chat_type = GROUP`. Các sự kiện khác (ví dụ `message.image.received`, chat riêng) ghi `outcome = ignored` kèm `ignore_reason` rồi trả 200.
4. **Kiểm tra nhóm.** Nếu `message.chat.id` không nằm trong `allowed_chat_ids`: ghi nhật ký Cloud Logging dòng chứa `chat_id` và tên nhóm không được phép (để bạn lấy mã nhóm thêm vào cấu hình), bỏ qua và trả 200.
5. **Chống trùng.** Tạo `processed_events/{message_id}` bằng thao tác tạo mới (thất bại nếu đã tồn tại). Đã tồn tại thì bỏ qua và trả 200.
6. **Cắt @tên bot.** Xóa phần `@{bot_mention_name}` (không phân biệt hoa thường, chấp nhận khoảng trắng thừa) khỏi `text`, rồi cắt khoảng trắng hai đầu. Nếu không còn nội dung thì câu trả lời là tin hướng dẫn: "Vui lòng nhắn @Bot TTHC Đảng kèm câu hỏi."
7. **Kiểm tra hạn mức.** Nếu `usage.messages_sent` của tháng đã bằng hoặc vượt `monthly_message_limit`: không gửi, ghi `outcome = ignored`, `ignore_reason = quota`. Khi đạt 80% hạn mức: ghi một dòng cảnh báo vào Cloud Logging.
8. **Trả lời.** Nếu `reply_enabled = true`: gọi `sendMessage` tới `chat_id = message.chat.id` với nội dung `Đã nhận: {câu hỏi}`, cắt còn tối đa 2000 ký tự. Thành công thì tăng `messages_sent`. Thất bại thì ghi `send_errors`, `outcome = error` và mô tả lỗi (không kèm token).
9. **Ghi nhật ký** `conversations/{message_id}`, cập nhật `processed_events.state`, đo `duration_ms`.
10. **Luôn trả 200** sau khi đã xác thực xong, kể cả khi gửi thất bại, để tránh Zalo gọi lại nhiều lần. Chưa rõ Zalo có gọi lại khi lỗi hay không và thời gian chờ tối đa là bao lâu (**chưa xác minh**; xem tiêu chí 7).

Xử lý đồng bộ trong một lần gọi: gửi tin xong mới trả lời Zalo. Đặt thời gian chờ của hàm là 60 giây.

## 7. Lớp gọi API Zalo (`zaloClient`)

| Hàm | Gọi | Ghi chú |
|---|---|---|
| `sendMessage(chatId, text)` | `POST https://bot-api.zaloplatforms.com/bot{TOKEN}/sendMessage` với `{ chat_id, text }` | JSON do mã tự dựng (`JSON.stringify`) |
| `sendPhoto(chatId, photoUrl, caption)` | `POST .../sendPhoto` với `{ chat_id, photo, caption }` | **Viết sẵn nhưng không dùng ở giai đoạn 1.** Chưa xác nhận hoạt động |
| `setWebhook(url, secret)` | `POST .../setWebhook` với `{ url, secret_token }` | Dùng trong script |
| `deleteWebhook()` | `POST .../deleteWebhook` | Dùng trong script; cần khi muốn quay lại `getUpdates` |

Mọi hàm kiểm tra phản hồi có `ok: true`, trả lỗi có cấu trúc (mã, mô tả) nếu không, và **không bao giờ ghi token vào nhật ký**. Có hết thời gian chờ cho mỗi lời gọi (đề xuất 10 giây).

## 8. Triển khai

1. Cài Firebase CLI, đăng nhập, khởi tạo Functions (TypeScript) trong thư mục dự án mới, chọn vùng `asia-southeast1`.
2. Tạo secrets: `firebase functions:secrets:set ZALO_BOT_TOKEN` và `ZALO_WEBHOOK_SECRET` (chuỗi 8-256 ký tự tự đặt). Nhập giá trị tại dấu nhắc, không viết vào lệnh.
3. Tạo `config/main` trong Firestore với `allowed_chat_ids` để trống ban đầu; bật chính sách TTL cho `processed_events.expire_at`; triển khai `firestore.rules` từ chối mọi truy cập từ client.
4. Triển khai hàm `zaloWebhook`, lấy địa chỉ HTTPS của hàm.
5. Chạy script `webhook-set` (đọc địa chỉ và secret từ biến môi trường, không nhập vào dòng lệnh). Nếu đang dùng `getUpdates` thì chạy `webhook-delete` trước.
6. @bot trong nhóm thử; xem nhật ký để lấy `chat.id` của nhóm, thêm vào `allowed_chat_ids`; @bot lại.

Kiểm tra cục bộ: trình giả lập Firebase không nhận được yêu cầu từ Zalo, nên dùng một tệp JSON mẫu (cấu trúc ở mục 9) và gửi POST có header đúng vào địa chỉ hàm để thử logic.

## 9. Mẫu sự kiện để kiểm thử

Dữ liệu thật đã thấy khi thử (đã thay mã bằng giá trị giả):

```json
{
  "event_name": "message.text.received",
  "message": {
    "message_id": "FAKEMSG00000000000001",
    "date": 1794668448525,
    "message_type": "CHAT_TEXT",
    "from": { "id": "FAKEUSER0000000000001", "display_name": "Ten Nguoi Dung", "is_bot": false },
    "chat": { "id": "zgr-FAKEGROUP000000000001", "chat_type": "GROUP" },
    "text": "@Bot TTHC Đảng xin chào"
  }
}
```

Sự kiện ảnh (bỏ qua ở giai đoạn này) có `event_name: message.image.received`, `message_type: CHAT_PHOTO`, thêm `photo_url` và `caption`.

## 10. Kiểm thử và tiêu chí hoàn thành

Kiểm thử đơn vị: cắt @ (có và không có khoảng trắng, hoa thường, chỉ có @ không kèm nội dung), so sánh secret, chống trùng, quyết định bỏ qua (sai loại sự kiện, sai chat_type, nhóm không cho phép, hết hạn mức).

| # | Tiêu chí | Cách kiểm tra |
|---|---|---|
| 1 | POST không có hoặc sai header trả 401 và không ghi gì | Gửi bằng công cụ HTTP |
| 2 | @bot trong nhóm được phép: bot trả lời "Đã nhận: ..." đúng nhóm, đã cắt phần @ | Thử thật trong nhóm |
| 3 | Gửi lại cùng một sự kiện (cùng `message_id`) chỉ trả lời một lần | Gửi POST hai lần |
| 4 | Nhóm không có trong `allowed_chat_ids`: bot không trả lời, có dòng nhật ký chứa mã nhóm | Thử nhóm khác |
| 5 | Sự kiện ảnh và chat riêng: bị bỏ qua, có bản ghi `ignored` | Gửi ảnh có @bot |
| 6 | `usage/{YYYY-MM}.messages_sent` khớp bộ đếm `sendMessage` trong ứng dụng quản lý bot | So sánh hai số |
| 7 | Có số đo `duration_ms`; ghi lại thời gian trả lời trung bình và có thấy Zalo gửi lại yêu cầu trùng không | Xem nhật ký sau vài ngày dùng |
| 8 | Không có token hay secret nào xuất hiện trong mã nguồn, tệp cấu hình hay nhật ký | Rà soát |

Cổng duyệt giai đoạn 1: đạt các tiêu chí 1 đến 6 và 8, và bot chạy ổn định ít nhất vài ngày trong nhóm thử.

## 11. Quy tắc cho Claude Code

- Làm đúng phạm vi mục 1; không thêm AI hay kho tri thức.
- Không ghi token, secret hay mã nhóm thật vào mã nguồn hay kho Git; dùng secrets và `config/main`.
- Hỏi lại khi gặp điều spec chưa nêu (ví dụ thân webhook khác mẫu), không tự đoán rồi làm tiếp.
- Báo cáo cuối giai đoạn: các tiêu chí đạt hay chưa, thời gian phản hồi đo được, mọi điều khác với tài liệu Zalo.
