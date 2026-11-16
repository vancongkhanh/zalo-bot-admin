# Trang quản trị (bước D)

`index.html` là toàn bộ trang: HTML và JavaScript thuần, Firebase JS SDK 13.1.0 tải từ `gstatic.com` (cố định phiên bản), không có bước build. Thư mục này chỉ giữ bản gốc và kiểm thử. Bản chạy thật đặt trên GitHub Pages ở một kho riêng.

## Màn hình

| Màn | Việc |
|---|---|
| Câu chưa trả lời | `unanswered` trạng thái `new`, xếp theo số lần hỏi rồi lần hỏi cuối (tối đa 100). Mỗi câu có 3 thao tác: **Soạn đáp án mới** (form điền sẵn tiêu đề và cách hỏi từ câu mẫu), **Gắn vào mục có sẵn** (thêm câu vào cách hỏi của mục, mặc định là mục AI đoán gần nhất), **Bỏ qua** |
| Kho tri thức | Tìm (không cần dấu), lọc theo trạng thái và nhóm, thêm, sửa, duyệt, ẩn. Chặn lưu khi trả lời > 1.500 ký tự hoặc link sai. Sửa mục đã duyệt phải đánh dấu ô xác nhận. Không xóa mục |
| Thống kê | Tháng hiện tại: tin đã gửi so với hạn mức, lượt gọi AI so với hạn mức, token, chi phí ước tính. Theo ngày (7/30/90 ngày): câu hỏi, tỷ lệ tự trả lời, chuyển ca, lỗi AI, mục dùng nhiều nhất. Số liệu chung cho mọi nhóm |
| Cài đặt | `reply_enabled`, `ai_enabled`, `confidence_threshold`, `handoff_message`, danh sách nhóm và **tên dễ nhớ cho từng mã nhóm** (lưu ở `config/main.chat_labels`) |

Mỗi lần lưu ghi `updated_by` (email người đăng nhập). Mục duyệt từ trang có `approved_by` là email. Sửa mục chạy trong transaction: nếu mục vừa bị script hoặc người khác sửa (`version` khác lúc mở), trang báo lỗi và không ghi đè.

## Cài đặt lần đầu (việc của bạn)

1. **Firebase Console > Authentication > Sign-in method:** bật **Google**.
2. **Project settings > Your apps:** thêm **Web app** (không cần Hosting). Chép `apiKey` và `appId` vào `FIREBASE_CONFIG` ở đầu `index.html`. Cấu hình này công khai theo thiết kế, an toàn dựa vào đăng nhập và quy tắc Firestore.
3. **Triển khai quy tắc và chỉ mục:** `firebase deploy --only firestore`. Chỉ mục `unanswered` cần vài phút mới sẵn sàng.
4. **Kho GitHub riêng:** đưa `index.html` lên, bật GitHub Pages. Thêm tên miền `<tài khoản>.github.io` vào **Authentication > Settings > Authorized domains**.
5. Mở trang, đăng nhập Google. Trang báo "chưa có quyền" kèm **UID**. Vào **Firestore > Data**, tạo collection `admins`, tài liệu có mã đúng bằng UID đó (thêm trường `email` để dễ nhận ra). Tải lại trang.

Muốn thêm người quản trị khác: họ đăng nhập để lấy UID, bạn tạo `admins/{uid}` cho họ. Muốn gỡ quyền: xóa tài liệu đó.

## Quyền (firestore.rules)

| Dữ liệu | Người trong `admins` | Người khác |
|---|---|---|
| `kb_items` | đọc, tạo, sửa (không đổi `hit_count`, `last_hit_at`, `created_at`; không xóa) | không |
| `unanswered` | đọc; chỉ đổi `status`, `answered_slug`, `answered_at`, `handled_by` | không |
| `stats_daily`, `usage`, `conversations` | chỉ đọc | không |
| `config/main` | đọc; chỉ sửa các trường của màn Cài đặt | không |
| `admins/{uid}` | đọc tài liệu của chính mình | đọc tài liệu của chính mình |
| `processed_events`, `eval_testset`, mọi thứ khác | không | không |

Cloud Functions và script `scripts/kb` dùng Admin SDK nên không bị giới hạn bởi các quy tắc này.

## Kiểm thử

```
cd admin
npm install
npm test               # logic của trang (không cần mạng)
npm run test:rules     # quy tắc Firestore trên emulator (cần Java 21), dự án demo, không đụng dữ liệu thật
```

Chạy thử trang với emulator (không đụng dữ liệu thật): `npm run emulator` ở một cửa sổ, rồi ở thư mục gốc chạy `python -m http.server 5173 --directory admin` và mở `http://localhost:5173/?emulator`. Bấm "Đăng nhập tài khoản giả (emulator)" (nút này chỉ hiện ở chế độ emulator), lấy UID trang hiện ra, rồi nạp dữ liệu giả và cấp quyền: `node test/seed-emulator.mjs <uid>` (trong thư mục `admin`).

Phần hàm thuần nằm giữa `LOGIC-START` và `LOGIC-END` trong `index.html` và được kiểm thử trực tiếp. Quy tắc kiểm tra mục kho chép từ `scripts/kb/lib/validate.mjs`: sửa một bên thì sửa cả bên kia.
