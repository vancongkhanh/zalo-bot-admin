# Spec bước G2: Xem ảnh gốc trong tab Lịch sử (lưu `photo_url` của Zalo)

Trạng thái: **đã triển khai 17/11/2026 (`zalowebhook-00010-wuv`).**

## 0. Căn cứ và phạm vi

- Bạn chọn ngày 17/11/2026: lưu đường link ảnh `photo_url` mà Zalo gửi kèm tin ảnh, để mở lại ảnh khi xem Lịch sử. Không lưu bản sao ảnh, không dùng Storage, không cần quản lý ảnh.
- Thay đổi này **bỏ một quy tắc của bước F**: "không ghi `photo_url` ở Firestore". Quy tắc "không ghi `photo_url` vào log" vẫn giữ.
- Chỉ đổi hàm `zaloWebhook` (ghi thêm một trường) và `admin/index.html` (hiện ảnh). Không đổi quy tắc Firestore, vì `conversations` vốn chỉ quản trị đọc được và không ai ghi được từ trình duyệt.

## 1. Quyết định chốt (đề xuất, bạn đổi nếu không đồng ý)

1. Webhook ghi `conversations.photo_url` cho **tin ảnh có gọi tên bot**. Gồm cả trường hợp bot không trả lời vì chưa bật đọc ảnh (`image_ai_disabled`), hết hạn mức, hay lỗi tải ảnh. Ảnh không gọi tên bot (`no_mention`) thì **không ghi**.
2. Chỉ ghi khi link là `https://` hợp lệ và dài tối đa 2.000 ký tự. Link sai mẫu thì ghi `photo_url: null` và log "Tin ảnh khác mẫu: photo_url không hợp lệ", không kèm link.
3. Không ghi `photo_url` vào log, `unanswered`, tin gửi Zalo hay gửi cho AI. Riêng AI vẫn nhận ảnh dạng base64 như bước F.
4. Bản ghi tự xóa sau 90 ngày cùng `conversations` (TTL sẵn có).
5. **Tab Lịch sử:** khối "Thông tin đọc từ ảnh" có ô ảnh.
   - Ảnh **mặc định làm mờ**. Bấm **"Xem ảnh"** thì hiện rõ và ghi một lần xem vào `pii_views`, giống nút "Hiện thông tin cá nhân". Một lần bấm mở cả ảnh lẫn thông tin cá nhân của tin đó.
   - Bấm vào ảnh đã hiện rõ thì mở ảnh cỡ gốc ở thẻ mới.
   - Ảnh tải với `referrerpolicy="no-referrer"` để Zalo không biết trang quản trị.
6. Link hết hạn hoặc Zalo chặn thì hiện "Ảnh không còn mở được trên Zalo (link có thể đã hết hạn)". Không thử tải lại, không báo lỗi khác.
7. Ảnh gửi trước khi triển khai không có link, nên hiện "Ảnh gửi trước khi bật lưu link, không xem lại được".
8. Trang chỉ hiện ảnh khi `photo_url` bắt đầu bằng `https://`, phòng dữ liệu lạ.

## 2. Rủi ro cần biết

- **Ai có link là xem được ảnh**, không cần đăng nhập. Link chỉ nằm trong Firestore, nơi chỉ quản trị đọc được. Ai có quyền quản trị hoặc vào Firebase Console vẫn lấy được link.
- Zalo có thể cho link hết hạn sau một thời gian mà mình không biết trước. Chưa rõ bao lâu; sẽ ghi lại sau khi thử thực tế.
- Ảnh chụp màn hình có thể chứa CCCD, số điện thoại, tên người. Cần báo nhóm: link ảnh gửi cho bot được lưu 90 ngày để hỗ trợ.

## 3. Tiêu chí G2

- G2.1. Tin ảnh có gọi tên bot (trả lời được, chuyển ca, lỗi tải ảnh, chưa bật đọc ảnh) có `photo_url`. Tin ảnh không gọi tên bot không có.
- G2.2. Link không phải `https://` hoặc quá dài thì ghi `null`.
- G2.3. `photo_url` không xuất hiện trong log (kể cả khi `log_raw_body` bật), `unanswered`, tin gửi Zalo.
- G2.4. Tab Lịch sử: ảnh mờ mặc định; bấm "Xem ảnh" thì hiện rõ và có một bản ghi `pii_views`; link hỏng thì hiện thông báo.
- G2.5. Kiểm thử hàm và kiểm thử logic trang qua. Kiểm thử F8 cũ đổi thành: link chỉ có ở `conversations`.

## 4. Việc của bạn

1. Duyệt spec.
2. Sau khi mình làm xong: đồng ý triển khai hàm `zaloWebhook`, tải `admin/index.html` mới lên `zalo-bot-admin`, báo nhóm.
3. Gửi thử một ảnh có gọi tên bot, rồi mở Lịch sử xem lại. Vài ngày sau mở lại để biết link Zalo còn sống bao lâu.

## 5. Quy tắc cho Claude Code

- Không ghi link ảnh thật vào mã nguồn, kiểm thử, Git hay log; kiểm thử dùng link giả.
- Thử trang trên emulator với link giả.
- Chỉ triển khai khi bạn đồng ý.

## 6. Kết quả thực hiện (17/11/2026)

- `functions/src/webhook.ts`: `storablePhotoUrl` (https, ≤ 2.000 ký tự); ghi `photo_url` cho tin ảnh có gọi tên bot ở mọi nhánh (trả lời, chuyển ca, lỗi tải ảnh, hết hạn mức, chưa bật đọc ảnh, tắt trả lời). Link sai mẫu: `null` và log cảnh báo không kèm link. `store.ts`: thêm trường.
- `admin/index.html`: ô ảnh trong khối "Thông tin đọc từ ảnh", mờ mặc định, nút "Xem ảnh" (hoặc "Xem ảnh và thông tin cá nhân") ghi `pii_views`; ảnh rõ bấm được để mở cỡ gốc ở thẻ mới (`noopener noreferrer`); ảnh tải với `referrerpolicy="no-referrer"`; link hỏng hiện "Ảnh không còn mở được trên Zalo".
- Kiểm thử: hàm 180 (thêm 7, sửa F8), logic trang 65 (thêm 2). Quy tắc không đổi (98).
- Thử trên emulator với link giả: ảnh mờ, bấm Xem ảnh thì rõ và hiện cả thông tin cá nhân, Ẩn lại thì mờ lại; link hỏng hiện thông báo.
- Khác spec: bỏ `loading="lazy"` vì ảnh chỉ được tạo khi mở dòng.
- Còn lại: tải `admin/index.html`, báo nhóm, thử ảnh thật và theo dõi link sống bao lâu.
