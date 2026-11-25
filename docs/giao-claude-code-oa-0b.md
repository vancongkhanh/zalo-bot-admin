# OA-0b: Xác thực quyền sở hữu URL với Zalo (bổ sung cho OA-0)

## 1. Bối cảnh
Zalo yêu cầu xác thực quyền sở hữu Webhook URL trước khi lưu. Zalo đã chấp nhận tiền tố URL của hàm và cho phương án "Tải tệp HTML lên trang web của bạn":
- Tiền tố cần xác thực: `https://asia-southeast1-zalo-bot-tthc-dang.cloudfunctions.net/zaloOaWebhook/`
- Zalo sẽ gọi `.../zaloOaWebhook/zalo_verifier<TÊN_TỆP>.html` và so nội dung với tệp bạn tải xuống.

## 2. Yêu cầu
| # | Yêu cầu |
|---|---|
| 1 | Khi nhận `GET` hoặc `HEAD` tới đường dẫn khớp **chính xác** một tên tệp trong danh sách cho phép (dạng `/zalo_verifier<TÊN>.html`), hàm trả đúng nội dung tệp HTML với `Content-Type: text/html; charset=utf-8`, mã 200 |
| 2 | Danh sách cho phép là hằng số trong mã nguồn (hoặc thư mục cố định trong dự án), đối chiếu **nguyên văn** tên tệp. Không ghép đường dẫn người gọi gửi vào hệ thống file. Không thể đọc file ngoài danh sách (chống path traversal, kể cả `..`, `%2e`, dấu `/` thừa) |
| 3 | Mọi đường dẫn và method khác giữ hành vi OA-0: trả 200 `{"ok":true}` |
| 4 | Log một sự kiện `zalo_verifier_hit` (chỉ ghi tên tệp và có khớp hay không), không ghi nội dung tệp |
| 5 | Nội dung tệp xác thực đóng gói cùng mã nguồn, không phải bí mật. Không thêm secret |
| 6 | Không làm hỏng các tiêu chí đã đạt của OA-0 (200 cho mọi request, độ trễ, log không lộ nội dung) |

## 3. Test
- GET đúng tên tệp: trả đúng nội dung (so từng byte với tệp gốc), Content-Type text/html.
- HEAD đúng tên tệp: 200.
- GET tên gần giống (thiếu/thừa ký tự, chữ hoa/thường khác, đuôi khác): 200 `{"ok":true}`, không trả nội dung tệp.
- Các thử path traversal (`/zalo_verifier../../x`, `%2e%2e`): 200 `{"ok":true}`, không đọc file.
- POST tới `/` và `/zalo_verifier...html`: 200 `{"ok":true}` như OA-0.

## 4. Việc của bạn (theo thứ tự)
1. Trong hộp thoại "Xác thực quyền sở hữu" của Zalo (cách "Tải tệp HTML"), bấm tải tệp `.html` xuống. **Giữ nguyên tab trình duyệt này mở** cho tới khi xong (mở lại hộp thoại có thể sinh tệp khác).
2. Chép tệp đó vào dự án, ví dụ thư mục `docs/` hoặc `verify/`, **giữ nguyên tên tệp**.
3. Dán đoạn giao việc ở mục 5 vào Claude Code.
4. Duyệt kế hoạch, để Claude Code viết và test, rồi chạy lệnh deploy riêng cho `zaloOaWebhook`.
5. Kiểm tra bằng trình duyệt: mở `https://asia-southeast1-zalo-bot-tthc-dang.cloudfunctions.net/zaloOaWebhook/zalo_verifier<TÊN_TỆP>.html` (đúng như dòng "Chú ý" trong hộp thoại Zalo). Phải thấy nội dung tệp.
6. Quay lại hộp thoại Zalo, bấm **Xác thực**.
7. Vào trang **Webhook** và nhập URL. Nếu Zalo báo không khớp tiền tố, thử URL có dấu `/` ở cuối: `.../zaloOaWebhook/` (hàm vẫn trả 200 cho đường dẫn này).

## 5. Đoạn giao việc cho Claude Code (dán nguyên văn)
```
Bổ sung cho hàm zaloOaWebhook (OA-0) đã deploy. Zalo yêu cầu xác thực quyền sở hữu URL bằng tệp HTML. Tệp xác thực đã được chép vào dự án (tôi sẽ chỉ rõ đường dẫn: <điền đường dẫn tệp>). Hãy đọc docs/spec-oa-0-webhook-toi-thieu.md và file giao việc OA-0b (docs/giao-claude-code-oa-0b.md) rồi:

1. Trình bày kế hoạch ngắn (file nào sửa/thêm, cách đóng gói tệp xác thực cùng mã nguồn, cách đối chiếu tên tệp an toàn). Dừng chờ tôi duyệt. Chưa viết code.
2. Sau khi tôi duyệt: viết code và test theo mục 2 và 3 của file giao việc. KHÔNG deploy, KHÔNG commit.
3. Cuối cùng: liệt kê file đã thêm/sửa, lệnh test, lệnh deploy chính xác (chỉ riêng hàm zaloOaWebhook), và xác nhận các test OA-0 cũ vẫn đạt.

Ràng buộc: không sửa hàm bot cũ zaloWebhook; không ghi nội dung tệp hay secret vào log; chỉ phục vụ tệp có tên nằm trong danh sách cho phép.
```
