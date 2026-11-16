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

## Đang triển khai ở đâu

| Hạng mục | Giá trị |
|---|---|
| Địa chỉ | `https://vancongkhanh.github.io/zalo-bot-admin/` |
| Kho GitHub | `vancongkhanh/zalo-bot-admin` (Public, GitHub Pages từ nhánh `main`, thư mục gốc). Chỉ chứa `index.html` |
| Firebase Web app | "Quan tri Bot TTHC" (tạo 16/11/2026 bằng `firebase apps:create`); `apiKey`, `appId` đã điền trong `index.html` |
| Đăng nhập | Firebase Auth, Google. Tên miền được phép: `vancongkhanh.github.io` (và `localhost` mặc định) |
| Quy tắc, chỉ mục | Đã triển khai 16/11/2026 (`firebase deploy --only firestore`) |

## Cài đặt lần đầu (đã làm, ghi lại để làm lại khi cần)

1. **Firebase Console > Authentication > Sign-in method:** bật **Google**.
2. **Web app:** `firebase apps:create web "<tên>"` rồi `firebase apps:sdkconfig web <appId>`, chép `apiKey` và `appId` vào `FIREBASE_CONFIG` ở đầu `index.html`. Hoặc tạo trong Console (Project settings > Your apps > Web). Cấu hình này công khai theo thiết kế.
3. **Quy tắc và chỉ mục:** `firebase deploy --only firestore`. Chỉ mục `unanswered` cần vài phút mới sẵn sàng.
4. **Kho GitHub riêng:** kho trống thì dùng liên kết "uploading an existing file" (chưa có nút Add file). Tải lên đúng một tệp `index.html`, rồi **Settings > Pages**: Deploy from a branch, `main`, `/ (root)`.
5. **Authentication > Settings > Authorized domains:** thêm `<tài khoản>.github.io` (chỉ tên miền, không `https://`, không đường dẫn). Thiếu bước này thì đăng nhập báo `auth/unauthorized-domain`.
6. Mở trang, đăng nhập Google. Trang báo "chưa có quyền" kèm **UID**. Vào **Firestore > Data**, tạo collection `admins`, Document ID đúng bằng UID đó (không dùng Auto-ID), thêm trường `email` (string). Tải lại trang.

Muốn thêm người quản trị khác: họ đăng nhập để lấy UID, bạn tạo `admins/{uid}` cho họ. Muốn gỡ quyền: xóa tài liệu đó.

## Cập nhật trang sau khi sửa

1. Sửa `admin/index.html` trong dự án này, chạy `npm test` (và `npm run test:rules` nếu đổi cách ghi dữ liệu hoặc `firestore.rules`).
2. Nếu đổi `firestore.rules` hay `firestore.indexes.json`: `firebase deploy --only firestore`.
3. Trên GitHub, mở `index.html` trong kho `zalo-bot-admin` > biểu tượng bút chì, hoặc **Add file > Upload files** để thay tệp, rồi **Commit changes**. Khoảng 1 phút sau trang mới có hiệu lực (tải lại bằng Ctrl+F5).

## Lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `auth/unauthorized-domain` | Thêm tên miền vào Authorized domains (bước 5) |
| "Tài khoản chưa có quyền quản trị" | Tạo `admins/{UID}` đúng UID trang hiện (bước 6) |
| "Không có quyền thực hiện" | Quy tắc chưa triển khai, hoặc thao tác bị quy tắc chặn (ví dụ sửa trường ngoài danh sách) |
| "Thiếu chỉ mục Firestore" | `firebase deploy --only firestore`, đợi vài phút |
| "Mục vừa được sửa ở nơi khác" | Script hoặc người khác vừa sửa mục: đóng form, mở lại |
| "Chưa có cấu hình Firebase" | `apiKey`/`appId` trong `FIREBASE_CONFIG` đang trống |

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

Kết quả 16/11/2026: 33 kiểm thử logic, 58 kiểm thử quy tắc đều đạt (gồm D1, D7; câu trả lời 1.500 ký tự có dấu được nhận, 1.501 bị từ chối).

Java: Temurin JDK 21 (adoptium.net), khi cài chọn "Add to PATH" và "Set JAVA_HOME"; mở cửa sổ cmd mới sau khi cài.

Chạy thử trang với emulator (không đụng dữ liệu thật): `npm run emulator` ở một cửa sổ, rồi ở thư mục gốc chạy `python -m http.server 5173 --directory admin` và mở `http://localhost:5173/?emulator`. Bấm "Đăng nhập tài khoản giả (emulator)" (nút này chỉ hiện ở chế độ emulator), lấy UID trang hiện ra, rồi nạp dữ liệu giả và cấp quyền: `node test/seed-emulator.mjs <uid>` (trong thư mục `admin`).

Phần hàm thuần nằm giữa `LOGIC-START` và `LOGIC-END` trong `index.html` và được kiểm thử trực tiếp. Quy tắc kiểm tra mục kho chép từ `scripts/kb/lib/validate.mjs`: sửa một bên thì sửa cả bên kia.
