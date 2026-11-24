# Giao Claude Code: OA-0 (webhook Zalo OA tối thiểu, bước chat 1-1)

## A. Việc của bạn trước khi giao (theo thứ tự)

| # | Việc | Ghi chú |
|---|---|---|
| 1 | Chép file `spec-oa-0-webhook-toi-thieu.md` vào dự án `zalo-bot-tthc-dang`, thư mục `docs/` | Claude Code đọc từ đây |
| 2 | Lấy **Khóa bí mật của ứng dụng** (developers.zalo.me > App > Cài đặt; bấm biểu tượng sao chép). Trang Webhook hiện không có "OA Secret Key" riêng; nếu sau này tìm được thì nhập thêm | Không dán vào chat, không ghi vào file |
| 3 | Nhập secret bằng lệnh của Firebase, gõ giá trị vào cửa sổ dòng lệnh khi được hỏi: `firebase functions:secrets:set ZALO_APP_SECRET_KEY` (và `ZALO_OA_SECRET_KEY` nếu có) | Giá trị không hiện trong lịch sử lệnh. Hàm thử cả hai khóa, cái nào thiếu thì bỏ qua |
| 4 | Báo cho người phụ trách OA (Nguyễn Khoa hoặc đơn vị) biết sẽ liên kết App và bật bot tự động trả lời. Nên có xác nhận bằng tin nhắn | Làm trước khi cấp quyền OA cho App ở bước C |
| 5 | Dán đoạn giao việc ở mục B vào Claude Code | |

## B. Đoạn giao việc (dán nguyên văn vào Claude Code)

```
Bối cảnh: dự án này đã có hàm webhook cho Zalo Bot (giai đoạn 1) chạy trên Firebase Cloud Functions gen2, Node.js/TypeScript, region asia-southeast1. KHÔNG sửa hàm bot hiện có và KHÔNG làm gián đoạn nó.

Nhiệm vụ: thêm MỘT hàm mới `zaloOaWebhook` theo đúng spec trong docs/spec-oa-0-webhook-toi-thieu.md. Đây là giai đoạn OA-0: chỉ nhận và ghi log, không gửi tin, không gọi API Zalo, không đọc/ghi Firestore, không dùng token.

Làm theo thứ tự:
1. Đọc spec và đọc cấu trúc dự án hiện tại (hàm bot, cách khai báo secret, cách ghi log, cấu hình test, README).
2. Trình bày KẾ HOẠCH NGẮN (file nào thêm/sửa, cách xử lý secret tùy chọn, cách lấy raw body). Dừng và chờ tôi duyệt. Chưa viết code.
3. Sau khi tôi duyệt: viết code và test, nhưng KHÔNG deploy. Tôi sẽ tự deploy.

Yêu cầu chốt:
- Mọi method và mọi nội dung đều trả HTTP 200 với {"ok":true}; mọi lỗi nội bộ được bắt, không bao giờ trả mã khác 200.
- Dùng raw body gốc (bytes) để thử chữ ký, không parse lại rồi stringify. Chữ ký chỉ để thử và ghi log kết quả khớp/không khớp, không được chặn request.
- Có hai secret ứng viên, đều TÙY CHỌN: ZALO_OA_SECRET_KEY và ZALO_APP_SECRET_KEY. Thử từng biến thể chữ ký với từng khóa có sẵn, ghi log sig_match theo từng khóa (oa_key, app_key). Khóa nào chưa có thì "skipped" và việc deploy không được lỗi. Đề xuất cách làm phù hợp với cách dự án đang khai báo secret.
- Log là một dòng JSON có cấu trúc theo bảng ở mục 5 của spec. Tuyệt đối không ghi nội dung tin nhắn, ID người dùng thật, token, chữ ký đầy đủ, secret. Chỉ ghi độ dài text, băm 8 ký tự đầu của ID, danh sách tên header, loại đính kèm.
- Nhận biết và đánh dấu sự kiện nhóm: user_send_group_* và oa_send_group_* (cờ is_oa_echo, mentions_oa theo spec). Chỉ ghi log, chưa xử lý gì.
- Không thêm thư viện nặng nếu không cần.

Test (tự động, chạy được không cần mạng):
- POST user_send_text mẫu, user_send_image, user_send_group_text, oa_send_group_text (mẫu lấy từ spec/tài liệu Zalo), POST body rỗng, body không phải JSON, GET.
- Tất cả trả 200; kiểm tra log không chứa nội dung tin và ID thật.
- Test chữ ký: tự tính chữ ký theo công thức sha256(appId + rawBody + timestamp + secret) bằng secret giả trong test, xác nhận biến thể khớp được ghi đúng, secret thiếu thì "skipped".
- Đo thời gian xử lý trong hàm.

Kết thúc: liệt kê file đã thêm/sửa, cách chạy test, lệnh deploy chính xác (chỉ riêng hàm này, ví dụ firebase deploy --only functions:zaloOaWebhook), và xác nhận hàm bot cũ không bị ảnh hưởng. Chưa commit nếu tôi chưa bảo.
```

## C. Việc của bạn sau khi Claude Code xong và bạn đã deploy

| # | Việc | Kiểm |
|---|---|---|
| 1 | Chạy curl vào URL hàm mới: POST JSON bất kỳ, POST rỗng, GET. Cả ba phải ra 200. Đo thời gian lần đầu | Tiêu chí 1–2 của spec |
| 2 | Vào trang Webhook của App, nhập URL của `zaloOaWebhook`, **Lọc cú pháp = tắt**, bật sự kiện `user_send_text`, lưu | Lưu được = tiêu chí 6 |
| 3 | Cấp quyền OA cho App bằng **API Explorer** (cách 2 trong tài liệu). Không dán access token vào chat | Cần Admin OA |
| 4 | Dùng một Zalo cá nhân đã quan tâm OA, nhắn "test" vào OA | |
| 5 | Mở Logs Explorer, tìm dòng log mới, chụp hoặc copy các trường: `event_name`, `sig_match`, `body_keys`, `num_retry`, `duration_ms`, `cold_start` | Báo lại mình |

Sau bước này mình soạn spec OA-1 (chữ ký thật, hàng đợi, token, gửi tin 1-1).
