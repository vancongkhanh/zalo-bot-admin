# Trang quản trị (bước D, ảnh bước E)

`index.html` là toàn bộ trang: HTML và JavaScript thuần, Firebase JS SDK 13.1.0 (app, auth, firestore, storage) tải từ `gstatic.com` (cố định phiên bản), không có bước build. Thư mục này chỉ giữ bản gốc và kiểm thử. Bản chạy thật đặt trên GitHub Pages ở một kho riêng.

## Màn hình

| Màn | Việc |
|---|---|
| Câu chưa trả lời | `unanswered` trạng thái `new`, xếp theo số lần hỏi rồi lần hỏi cuối (tối đa 100). Mỗi câu có 3 thao tác: **Soạn đáp án mới** (form điền sẵn tiêu đề và cách hỏi từ câu mẫu), **Gắn vào mục có sẵn** (thêm câu vào cách hỏi của mục, mặc định là mục AI đoán gần nhất), **Bỏ qua**. Câu từ ảnh (bước F) có nhãn **Ảnh** và mô tả do AI viết (ảnh không được lưu nên không xem lại được); tiền tố `[Ảnh] ` được bỏ khi dùng làm cách hỏi |
| Trả lời người hỏi | (docs/spec-tra-loi-nguoi-hoi.md) Thẻ hiện **"N người hỏi · M nhóm"** (ask `pending`/`failed` trong `unanswered/{id}/asks`, đọc bằng một truy vấn collectionGroup); câu có từ trước tính năng hiện "Không có thông tin người hỏi". Hộp **Soạn đáp án mới** và **Gắn vào mục có sẵn** có khối **Gửi trả lời cho người đã hỏi**: chọn từng người (quá 72 giờ, nhóm không còn trong cấu hình, thiếu mã nhóm: bỏ chọn sẵn), sửa phần gửi đi (mặc định là nội dung + link của mục; sửa không đổi mục kho), xem trước đúng tin từng nhóm, đếm x/2000. Chỉ gửi khi mục ở trạng thái Đã duyệt. Nút đổi thành **Duyệt & gửi (N nhóm)**: lưu kho trước (lỗi thì không gửi), rồi gọi hàm `sendReplyToAskers`; kết quả từng nhóm và nút **Gửi lại** các nhóm lỗi. Câu đã có đáp án mà còn người chưa được trả lời hiện ở cuối tab với **Gửi trả lời** và **Bỏ qua** (hàm `skipAsks`). Hàm dựng tin là bản chép của `functions/src/replyMessage.ts`, cùng chạy bộ mẫu `functions/test/fixtures/reply-message.json`. Emulator: hai hàm được giả lập, không đổi dữ liệu (nhóm có chữ `loi` giả lập lỗi) |
| Lịch sử (bước G) | Các lần bot được gọi tên trong `conversations` (90 ngày), mới nhất trước, phân trang 10/20/50 dòng (nhớ theo máy; tải thêm từ Firestore mỗi lần 50 dòng khi sang trang chưa tải). Lọc: Tất cả, Trả lời được, Chuyển ca, Lỗi, Bot không trả lời (tắt trả lời, hết hạn mức, chưa bật đọc ảnh); theo nhóm; hôm nay, 7, 30, 90 ngày; ô tìm trong các dòng đã tải. Tin không gọi tên bot không bao giờ hiện. Bấm dòng: ba khối Người dùng đã nhắn, Thông tin đọc từ ảnh (mô tả, chữ trên ảnh, ảnh gốc qua link Zalo — bước G2: mờ đến khi bấm **Xem ảnh**, link hỏng thì báo hết hạn), Bot đã hỗ trợ (mục, độ tin cậy, nguyên văn câu trả lời, ảnh gửi kèm, thời gian xử lý), nút Mở mục. Thông tin cá nhân (đoạn `⟦…⟧` do AI đánh dấu, số điện thoại, CCCD, email) hiện là `[đã ẩn]`; **Hiện thông tin cá nhân** / **Xem ảnh** ghi `pii_views` trước khi hiện. Cuối màn có nhật ký 20 lần xem gần nhất. Cần các chỉ mục `conversations` trong `firestore.indexes.json`. Bộ lọc **Admin trả lời** (Trả lời người hỏi, bước 6): mỗi nhóm gửi được có một bản ghi `conversations/admin_reply_{batchId}_{n}` với `outcome: "admin_reply"`, tên người được trả lời (`reply_to_names`), người gửi (`sent_by`), tin đã gửi; không tính vào thống kê câu hỏi của bot |
| Thêm vào câu gợi ý | (docs/spec-them-cau-hoi-goi-y.md) Thẻ Lịch sử **Trả lời được** có mục kho còn **Đã duyệt** và có câu chữ: nút **Thêm vào câu gợi ý** cạnh "Mở mục" (đã thêm thì hiện "✓ Đã thêm vào gợi ý"). Hộp thoại điền sẵn câu đã bỏ `@tên bot`, phần thông tin cá nhân thay bằng `[đã ẩn]`; câu còn thông tin cá nhân, ngoài 5–300 ký tự, hoặc mục đã đủ 50 cách hỏi thì không lưu được. Đổi được mục đích (ô tìm); độ tin cậy dưới `config/main.suggestion_warn_confidence` (mặc định 0.85, sửa ở Cài đặt) có cảnh báo vàng; xem các cách hỏi hiện có; câu đã có trong mục thì chỉ đánh dấu, câu đang ở mục khác thì cảnh báo đỏ và hỏi xác nhận lần 2. Ghi qua hàm `addSuggestedQuestion` (kiểm tra trùng lần cuối, ghi mục + `kb_suggestion_log` + đánh dấu bản ghi Lịch sử trong một transaction; giữ nguyên người duyệt). Bot dùng câu mới sau tối đa khoảng 1 phút. Emulator: hàm được giả lập, không ghi dữ liệu |
| Kho tri thức | Tìm (không cần dấu), lọc theo trạng thái và nhóm, phân trang 10/20/50 dòng, thêm, sửa, duyệt, ẩn. Chặn lưu khi trả lời > 1.500 ký tự hoặc link sai. Sửa mục đã duyệt (kể cả đổi ảnh) hiện ô xác nhận, đánh dấu sẵn; bỏ đánh dấu thì không lưu. Không xóa mục |
| Gợi ý cách hỏi | Nút **Đề xuất cách hỏi bằng AI** dưới ô "Các cách hỏi": gọi hàm `suggestQuestions` (Claude, model theo `config/main.ai_model`) với tiêu đề, nhóm, nội dung trả lời và các cách hỏi đã có. Hiện tối đa 8 gợi ý có ô tích; bấm **Thêm các câu đã chọn** để đưa vào ô (bỏ câu trùng, kể cả khác dấu). Không tự lưu. Chỉ người trong `admins` gọi được; mỗi lần bấm là một lượt gọi AI (đếm ở `usage.suggest_*`). Ở chế độ emulator trả gợi ý giả, không gọi AI |
| Ảnh của mục (bước E) | Trong form mục: **+ Thêm ảnh** (chọn nhiều tệp) hoặc dán ảnh chụp màn hình bằng Ctrl+V khi form đang mở. Trang thu nhỏ còn cạnh dài 1.600 px, chuyển JPEG 85%, rồi tải lên Storage `kb_images/{slug}/`. Chặn tệp gốc > 10 MB. Nút ↑ ↓ đổi thứ tự (là thứ tự bot gửi), ô chú thích (trống thì bot ghi "Bước i/n"), nút **Gỡ**. Tối đa 10 ảnh. Ảnh chỉ vào mục khi bấm **Lưu**; Hủy hoặc Gỡ thì tệp vẫn nằm trong Storage. Mục mới phải có mã mục hợp lệ trước khi thêm ảnh, và mã bị khóa sau khi đã tải ảnh |
| Thống kê (tab đầu, mở mặc định) | Đầu trang: câu hỏi qua AI theo ngày (mặc định 7 ngày; 7/30/90): câu hỏi, tỷ lệ tự trả lời, chuyển ca, lỗi AI, câu hỏi bằng ảnh; biểu đồ tròn mục dùng nhiều nhất (5 mục lớn nhất, còn lại gộp "Các mục khác"); bảng theo ngày. Bên dưới, tháng hiện tại: tin đã gửi so với hạn mức (đã gồm ảnh), ảnh đã gửi, lượt gọi AI so với hạn mức, token, chi phí ước tính, lượt đọc ảnh so với hạn mức và token ảnh (bước F). Số liệu chung cho mọi nhóm; ô Chi phí AI ước tính có thêm dòng quy ra VND theo giá bán USD Vietcombank (hàm `usdVndRate`, đệm 6 giờ; lỗi thì báo chưa lấy được tỷ giá) |
| Cài đặt | `reply_enabled`, `ai_enabled`, `confidence_threshold`, `handoff_message`, `max_images_per_answer` (0-10), khu "Đọc ảnh người dùng gửi" (bước F: `image_ai_enabled`, `image_summary_enabled`, `monthly_image_ai_limit`, `image_quota_message`, `image_text_enabled` (bước G); bật đọc ảnh có hộp xác nhận nhắc ảnh được gửi cho dịch vụ AI), danh sách nhóm và **tên dễ nhớ cho từng mã nhóm** (lưu ở `config/main.chat_labels`) |

Mỗi lần lưu ghi `updated_by` (email người đăng nhập). Mục duyệt từ trang có `approved_by` là email. Sửa mục chạy trong transaction: nếu mục vừa bị script hoặc người khác sửa (`version` khác lúc mở), trang báo lỗi và không ghi đè.

## Đang triển khai ở đâu

| Hạng mục | Giá trị |
|---|---|
| Địa chỉ | `https://vancongkhanh.github.io/zalo-bot-admin/` |
| Kho GitHub | `vancongkhanh/zalo-bot-admin` (Public, GitHub Pages từ nhánh `main`, thư mục gốc). Chỉ chứa `index.html` |
| Firebase Web app | "Quan tri Bot TTHC" (tạo 16/11/2026 bằng `firebase apps:create`); `apiKey`, `appId` đã điền trong `index.html` |
| Đăng nhập | Firebase Auth, Google. Tên miền được phép: `vancongkhanh.github.io` (và `localhost` mặc định) |
| Quy tắc, chỉ mục | Đã triển khai 16/11/2026 (`firebase deploy --only firestore`). Bản có ảnh (bước E) triển khai 16/11/2026 |
| Storage (bước E) | Bucket `zalo-bot-tthc-dang.firebasestorage.app` (đã đối chiếu, khớp `FIREBASE_CONFIG.storageBucket`); `storage.rules` triển khai 16/11/2026 |

## Cài đặt lần đầu (đã làm, ghi lại để làm lại khi cần)

1. **Firebase Console > Authentication > Sign-in method:** bật **Google**.
2. **Web app:** `firebase apps:create web "<tên>"` rồi `firebase apps:sdkconfig web <appId>`, chép `apiKey` và `appId` vào `FIREBASE_CONFIG` ở đầu `index.html`. Hoặc tạo trong Console (Project settings > Your apps > Web). Cấu hình này công khai theo thiết kế.
3. **Quy tắc và chỉ mục:** `firebase deploy --only firestore`. Chỉ mục `unanswered` cần vài phút mới sẵn sàng.
4. **Kho GitHub riêng:** kho trống thì dùng liên kết "uploading an existing file" (chưa có nút Add file). Tải lên đúng một tệp `index.html`, rồi **Settings > Pages**: Deploy from a branch, `main`, `/ (root)`.
5. **Authentication > Settings > Authorized domains:** thêm `<tài khoản>.github.io` (chỉ tên miền, không `https://`, không đường dẫn). Thiếu bước này thì đăng nhập báo `auth/unauthorized-domain`.
6. Mở trang, đăng nhập Google. Trang báo "chưa có quyền" kèm **UID**. Vào **Firestore > Data**, tạo collection `admins`, Document ID đúng bằng UID đó (không dùng Auto-ID), thêm trường `email` (string). Tải lại trang.

7. **Bước E, Storage:** Console > Build > Storage > Get started, chọn vùng (spec E đề xuất `US-CENTRAL1`, **không đổi được sau khi tạo**), chế độ production. Rồi `firebase deploy --only storage` và `firebase deploy --only firestore` (quy tắc có `images`, `max_images_per_answer`). Lần đầu CLI có thể hỏi cấp quyền cho Storage đọc Firestore: trả lời Yes (quy tắc Storage kiểm tra `admins/{uid}`).

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
| "Storage từ chối tải ảnh" | Chưa có `admins/{uid}`, `storage.rules` chưa triển khai, hoặc ảnh sau nén vẫn > 5 MB |
| "Chưa kết nối được Firebase Storage" | Storage chưa bật, hoặc `storageBucket` trong `FIREBASE_CONFIG` sai tên |
| "Ảnh i không hợp lệ (gỡ rồi tải lại)" | Ảnh không thuộc thư mục của mục hoặc link không phải https |

## Quyền (firestore.rules)

| Dữ liệu | Người trong `admins` | Người khác |
|---|---|---|
| `kb_items` | đọc, tạo, sửa (không đổi `hit_count`, `last_hit_at`, `created_at`, `image_urls`; `images` tối đa 10; không xóa) | không |
| `unanswered` | đọc; chỉ đổi `status`, `answered_slug`, `answered_at`, `handled_by` | không |
| `stats_daily`, `usage`, `conversations` | chỉ đọc | không |
| `config/main` | đọc; chỉ sửa các trường của màn Cài đặt | không |
| Storage `kb_images/{slug}/{tệp}` (`storage.rules`) | tạo tệp mới JPEG/PNG/WEBP ≤ 5 MB, đọc thông tin tệp; không ghi đè, không xóa, không liệt kê | không |
| `admins/{uid}` | đọc tài liệu của chính mình | đọc tài liệu của chính mình |
| `processed_events`, `eval_testset`, mọi thứ khác | không | không |

Cloud Functions và script `scripts/kb` dùng Admin SDK nên không bị giới hạn bởi các quy tắc này. Zalo tải ảnh bằng download URL có token, không đi qua `storage.rules`.

## Kiểm thử

```
cd admin
npm install
npm test               # logic của trang (không cần mạng)
npm run test:rules     # quy tắc Firestore và Storage trên emulator (cần Java 21), dự án demo, không đụng dữ liệu thật
```

Kết quả 16/11/2026: 33 kiểm thử logic, 58 kiểm thử quy tắc đều đạt (gồm D1, D7; câu trả lời 1.500 ký tự có dấu được nhận, 1.501 bị từ chối).
Sau bước E (16/11/2026): 45 kiểm thử logic, 79 kiểm thử quy tắc đều đạt (gồm E6: người ngoài `admins` không tải được ảnh; tệp không phải ảnh, GIF, > 5 MB, ghi đè, xóa, liệt kê đều bị chặn).

Java: Temurin JDK 21 (adoptium.net), khi cài chọn "Add to PATH" và "Set JAVA_HOME"; mở cửa sổ cmd mới sau khi cài.

Chạy thử trang với emulator (không đụng dữ liệu thật, gồm cả Storage emulator cổng 9199): `npm run emulator` ở một cửa sổ, rồi ở thư mục gốc chạy `python -m http.server 5173 --directory admin` và mở `http://localhost:5173/?emulator`. Bấm "Đăng nhập tài khoản giả (emulator)" (nút này chỉ hiện ở chế độ emulator), lấy UID trang hiện ra, rồi nạp dữ liệu giả và cấp quyền: `node test/seed-emulator.mjs <uid>` (trong thư mục `admin`).

Phần hàm thuần nằm giữa `LOGIC-START` và `LOGIC-END` trong `index.html` và được kiểm thử trực tiếp. Quy tắc kiểm tra mục kho chép từ `scripts/kb/lib/validate.mjs`: sửa một bên thì sửa cả bên kia.
