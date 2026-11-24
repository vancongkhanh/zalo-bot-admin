# Spec OA-0: Webhook Zalo OA tối thiểu (chỉ nhận và ghi log)

## 1. Mục tiêu
- Có một địa chỉ HTTPS trả HTTP 200 dưới 2 giây cho mọi request, để đăng ký được Webhook trên developers.zalo.me.
- Xem được dữ liệu sự kiện thật (cấu trúc, header) để chốt cách xác thực chữ ký cho OA-1.
- Chưa trả lời người dùng, chưa gọi AI, chưa dùng token.

## 2. Ngoài phạm vi
Không gửi tin, không gọi API Zalo, không đọc/ghi Firestore, không hàng đợi, không làm mới token. Không sửa hàm bot hiện tại.

## 3. Hàm
| Mục | Giá trị |
|---|---|
| Tên | `zaloOaWebhook` (Cloud Functions gen2, Node.js/TypeScript) |
| Region | asia-southeast1 |
| Truy cập | Công khai (allUnauthenticated) |
| Instance tối thiểu | 0 (cold start đã đo ~1046 ms ở giai đoạn 1, còn dưới 2 s). Quyết định đặt 1 ở OA-1 |
| Timeout | 10 giây |
| Bí mật (đều **tùy chọn**, trong Secret Manager) | `ZALO_OA_SECRET_KEY` (OA Secret Key, nếu tìm được) và `ZALO_APP_SECRET_KEY` (Khóa bí mật của ứng dụng, ở trang Cài đặt App). Vì giao diện hiện tại không hiện OA Secret Key riêng, OA-0 thử **cả hai** làm khóa kiểm tra chữ ký. Cái nào chưa có thì bỏ qua cái đó. Không được lỗi deploy khi thiếu |

## 4. Hành vi
1. Mọi method (POST, GET, khác) và mọi nội dung, kể cả rỗng hay không phải JSON: trả **200** với `{"ok":true}`.
2. **Luôn trả 200 trước**, rồi mới (hoặc cùng lúc, không chờ) ghi log. Mọi lỗi xử lý nội bộ được bắt (try/catch), không bao giờ làm trả mã khác 200.
3. Không chặn theo chữ ký ở OA-0 (Zalo gửi POST thử lúc đăng ký, có thể không có chữ ký).

## 5. Nội dung log (Cloud Logging, một dòng JSON có cấu trúc, `severity=INFO`)
| Trường | Cách ghi |
|---|---|
| method, content_type, content_length | nguyên văn |
| header_names | danh sách tên header (chữ thường), **không** ghi giá trị, ngoại trừ các mục dưới |
| x_zevent_signature | độ dài + 6 ký tự đầu + có tiền tố `mac=` hay không (không ghi đủ chuỗi) |
| num_retry | giá trị header nếu có |
| body_parse_ok | true/false |
| event_name, app_id (che: 3 ký tự đầu + 3 cuối), timestamp, msg_id | nguyên văn trừ app_id |
| sender_hash, recipient_hash | 8 ký tự đầu của SHA-256 (không ghi ID thật) |
| text_length | độ dài `message.text` (**không ghi nội dung tin**) |
| has_quote_msg_id | true/false |
| attachment_types | danh sách `type`, không ghi URL |
| body_keys | danh sách khóa cấp 1 của body (để thấy sự kiện lạ) |
| group_id_hash | (sự kiện nhóm) 8 ký tự đầu SHA-256 của `recipient.id` |
| mentions_oa | (sự kiện nhóm) true/false: text có chứa `[@oa_id]` không (chỉ ghi true/false, không ghi nội dung) |
| is_oa_echo | true nếu `event_name` bắt đầu bằng `oa_send_group_` |
| duration_ms | thời gian xử lý trong hàm |
| cold_start | true/false |

## 6. Thử công thức chữ ký (chỉ khi có `ZALO_OA_SECRET_KEY`)
Tài liệu chính thức: header `X-ZEvent-Signature`, `mac = sha256(appId + data + timeStamp + OAsecretKey)`, với `data` là **chuỗi JSON thô của body**.

Tính trên **raw body (bytes gốc, không parse lại rồi stringify)**. Thử các biến thể, chỉ ghi log kết quả khớp/không khớp (không ghi giá trị tính ra):
| Biến thể | Mô tả |
|---|---|
| V1 | hex(sha256(app_id + rawBody + timestamp + secret)) |
| V2 | như V1 nhưng header có tiền tố `mac=` thì bỏ tiền tố trước khi so |
| V3 | HMAC-SHA256 với khóa là secret trên chuỗi (app_id + rawBody + timestamp) |
| V4 | như V1 nhưng `timestamp` lấy từ header (nếu có) thay vì từ body |
Chạy mỗi biến thể với **từng khóa có sẵn** (OA Secret Key, App Secret). Log: `sig_match: { oa_key: "V1"|"V2"|...|"none"|"skipped", app_key: "V1"|"V2"|...|"none"|"skipped" }`. Kết quả cho biết đúng khóa nào và đúng công thức nào. So sánh bằng `timingSafeEqual`. Không ghi giá trị khóa hay chữ ký đã tính vào log.

## 7. Bảo mật
- Không ghi secret, token, nội dung tin nhắn, ID người dùng thật vào log, repo hay chat.
- Secret chỉ vào Secret Manager (người dùng tự nhập), không dán vào đoạn chat.
- Không commit file `.env`.

## 8. Tiêu chí nghiệm thu
| # | Tiêu chí | Cách kiểm |
|---|---|---|
| 1 | POST JSON bất kỳ, POST rỗng, GET đều trả 200 | curl |
| 2 | Thời gian phản hồi lần nguội < 2 s, lần ấm < 500 ms | curl -w time_total, đo 5 lần |
| 3 | Log đúng cấu trúc mục 5, không lộ nội dung tin, ID, chữ ký đầy đủ | đọc Logs Explorer |
| 4 | Body hỏng không làm trả mã khác 200 | curl với body sai |
| 5 | Triển khai không ảnh hưởng hàm bot hiện tại | bot vẫn trả lời bình thường |
| 6 | Đăng ký Webhook URL trên developers.zalo.me lưu được | thao tác của người dùng |

## 9. Việc của người dùng sau khi triển khai (theo thứ tự)
1. Thêm secret `ZALO_OA_SECRET_KEY` (tìm khóa bí mật OA ở trang cài đặt App, **khác** khóa bí mật App; không dán vào chat).
2. Nhập Webhook URL (HTTPS) ở trang Webhook của App, để **Lọc cú pháp = tắt**, bật sự kiện `user_send_text`, lưu.
3. Cấp quyền OA cho App (cần sự đồng ý của đơn vị sở hữu OA). Dùng công cụ API Explorer của Zalo (cách 2 trong tài liệu) để không cần callback URL ở OA-0.
4. Dùng một tài khoản Zalo cá nhân nhắn "test" tới OA, xem log.
5. Báo lại: `event_name`, `sig_match`, `body_keys`, `num_retry` (copy từ log, đã che sẵn).
