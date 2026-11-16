# Spec bước E: ảnh trong câu trả lời

Dành cho Claude Code. Ngày soạn: 16/11/2026. Trạng thái: **bạn đã duyệt ngày 16/11/2026; đã triển khai 16/11/2026; chờ thử thật** (xem mục 9). Đọc kèm [spec-buoc-A-B-C-D.md](spec-buoc-A-B-C-D.md) (spec này sửa quyết định 7 của spec đó: "Ảnh trong câu trả lời: chưa làm").

## 0. Căn cứ và phạm vi

- **Đã kiểm chứng ngày 16/11/2026:** `sendPhoto` gửi được ảnh từ link công khai. Zalo trả `message_type: "CHAT_PHOTO"`. Trên điện thoại ảnh hiện bình thường. Trên Zalo máy tính, ảnh hiện ô tải xuống cho tới khi người xem bấm vào: đây là cách hiển thị của Zalo, không phải lỗi.
- **Chưa kiểm chứng:**
  - gửi nhiều ảnh trong một tin;
  - giới hạn dung lượng và kích thước ảnh của Zalo;
  - ảnh từ Firebase Storage. Mới thử ảnh trên GitHub Pages và placehold.co.

  Spec này không dựa vào gửi nhiều ảnh trong một tin: mỗi ảnh là một tin riêng.
- **Phạm vi:**
  - Bạn tải ảnh lên trong form mục của trang quản trị.
  - Bot gửi tin chữ trước, rồi đến các ảnh.
  - Bộ đếm hạn mức tính cả ảnh.
- **Ngoài phạm vi:**
  - nhập ảnh tự động từ PDF;
  - đọc ảnh người dùng gửi tới bot;
  - sửa hay vẽ lên ảnh.

## 1. Quyết định chốt (đề xuất, bạn đổi nếu không đồng ý)

| # | Quyết định | Đề xuất | Lý do |
|---|---|---|---|
| 1 | Nơi lưu ảnh | **Firebase Storage** (bạn đã chọn) | Tải ngay từ trang quản trị, không phải làm tay |
| 2 | Vùng của bucket | **`US-CENTRAL1`** (xem 1.1) | Có hạn mức miễn phí; ảnh tải chậm hơn một chút không đáng kể |
| 3 | Số ảnh mỗi mục | Tối đa **10** | Bạn nói đa số dưới 4 ảnh, có mục nhiều hơn |
| 4 | Số ảnh gửi mỗi câu trả lời | Cấu hình `max_images_per_answer`, mặc định **4**, cho phép 0-10. Mục có nhiều ảnh hơn: gửi số ảnh đầu tiên theo cấu hình, **ảnh còn lại đưa thành link** cuối tin chữ ("Ảnh 5: https://...") | Giữ chi phí tin ổn định mà không mất ảnh. Đặt `0` để tắt gửi ảnh |
| 5 | Thứ tự gửi | Tin chữ trước, sau đó từng ảnh theo thứ tự trong mục | Người đọc thấy hướng dẫn trước, ảnh minh họa sau |
| 6 | Chú thích ảnh | Tự đặt "Bước 1/3", "Bước 2/3"…; mỗi ảnh có thể có chú thích riêng (tối đa 200 ký tự) thay cho chú thích tự đặt | Người xem biết ảnh nào đi với bước nào |
| 7 | Gần hết hạn mức tin | Nếu số tin còn lại không đủ cho chữ + ảnh: **chỉ gửi tin chữ, các ảnh thành link** | Không bao giờ vượt 3.000 tin vì ảnh |
| 8 | Ảnh gửi lỗi | Ghi lỗi, gửi tiếp các ảnh sau; tin chữ đã gửi vẫn giữ | Một ảnh hỏng không làm hỏng cả câu trả lời |
| 9 | Xử lý ảnh trước khi tải lên | Trang tự thu nhỏ: cạnh dài tối đa 1.600 px, chuyển sang JPEG chất lượng 85%. Chặn tệp gốc > 10 MB | Ảnh nhẹ (thường dưới 500 KB), Zalo tải nhanh, tiết kiệm Storage |
| 10 | Gỡ ảnh khỏi mục | Chỉ gỡ khỏi danh sách của mục; **tệp vẫn còn trong Storage**. Dọn tệp không dùng là việc sau | Không xóa dữ liệu ngoài ý muốn; khôi phục được nếu gỡ nhầm |

### 1.1 Chi phí Storage (cần bạn đối chiếu trang giá Firebase trước khi chốt)

- Từ cuối 2024, bucket mặc định mới (`*.firebasestorage.app`) chỉ có hạn mức miễn phí ở các vùng `US-CENTRAL1`, `US-EAST1`, `US-WEST1`: khoảng 5 GB lưu trữ, cộng hạn mức tải xuống hằng ngày.
- Chọn `asia-southeast1` thì bị tính phí ngay từ byte đầu tiên, nhưng rất nhỏ: vài trăm ảnh khoảng 300 KB là khoảng 0,1 GB, dưới 0,01 USD/tháng.
- **Lưu ý: vùng bucket không đổi được sau khi tạo.**

| Ước tính | Số liệu |
|---|---|
| 50 mục × 4 ảnh × 300 KB | khoảng 60 MB lưu trữ |
| Mỗi lần gửi ảnh, Zalo tải ảnh một lần | 3.000 tin/tháng × 300 KB ≈ 0,9 GB/tháng tải xuống |

## 2. Dữ liệu

### 2.1 `kb_items/{slug}`: trường `images` thay cho `image_urls`

`image_urls` (đang để trống) được thay bằng `images`, là mảng đối tượng:

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `url` | chuỗi | Link tải (download URL có token) của Firebase Storage; bot gửi link này |
| `path` | chuỗi | Đường dẫn trong bucket: `kb_images/{slug}/{mã ngẫu nhiên}.jpg` |
| `caption` | chuỗi | Tùy chọn, tối đa 200 ký tự |
| `width`, `height`, `bytes` | số | Sau khi thu nhỏ |

- Đổi `images` (thêm, gỡ, đổi thứ tự, sửa chú thích) là đổi nội dung, nên `version` tăng.
- Mục đã duyệt mà đổi ảnh thì phải tích ô xác nhận, như khi sửa nội dung trả lời.
- `image_urls` cũ: không còn ghi nữa; mục nào đang có `image_urls: []` cứ để nguyên.

### 2.2 `config/main`

| Trường | Mặc định | Ghi chú |
|---|---|---|
| `max_images_per_answer` | `4` | 0-10. `0` = không gửi ảnh (ảnh vẫn hiện thành link) |

Trang quản trị (màn Cài đặt) được sửa trường này.

### 2.3 Bộ đếm và nhật ký

| Nơi | Thêm |
|---|---|
| `usage/{tháng}` | Mỗi lần gọi `sendPhoto` tăng `messages_sent`, kể cả lỗi (quyết định 3); thêm `photos_sent`, `photo_errors` |
| `conversations` | `images_sent` (số ảnh gửi thành công), `image_errors` (số lỗi), `images_as_links` (số ảnh chuyển thành link) |
| `stats_daily` | `photos_sent` |

## 3. Luồng gửi (thay bước 7 của luồng bước C)

1. Mục được chọn có `images`. Lấy `n = min(số ảnh, max_images_per_answer)`; các ảnh còn lại thành link.
2. Kiểm tra hạn mức: nếu tin đã gửi trong tháng + 1 + `n` > `monthly_message_limit`, thì `n = 0`, mọi ảnh thành link (quyết định 7).
3. Ghép tin chữ:
   - `answer` + các link của mục;
   - rồi các ảnh thành link, dạng `Ảnh {i}: {url}`.

   Tổng tin chữ vẫn tối đa 2.000 ký tự. Nếu quá, bớt link ảnh trước, rồi bớt link thường, và ghi cảnh báo trong log.
4. Gửi tin chữ. **Tin chữ lỗi thì không gửi ảnh.**
5. Gửi lần lượt `n` ảnh bằng `sendPhoto(chat_id, url, caption)`, ghi kết quả từng ảnh. Ảnh lỗi thì ghi lỗi rồi gửi tiếp (quyết định 8).
6. Ghi bộ đếm, `conversations`, `stats_daily`. Luôn trả HTTP 200.

**Thời gian:** mỗi `sendPhoto` ước khoảng 0,5–1 giây, nên 4 ảnh cộng thêm khoảng 2–4 giây, vẫn xa mức timeout 60 giây của hàm. Chống trùng `message_id` đã ghi trước khi gọi AI nên Zalo có gửi lại cũng không gửi ảnh hai lần. Cần đo lại `duration_ms`, và theo dõi Zalo có gửi lại yêu cầu khi hàm chạy lâu hơn không.

## 4. Trang quản trị

| Chỗ | Thay đổi |
|---|---|
| Form mục | Khu "Ảnh": nút **Thêm ảnh** (chọn nhiều tệp, hoặc dán ảnh chụp màn hình bằng Ctrl+V), ô xem trước nhỏ, nút lên/xuống để đổi thứ tự, ô chú thích, nút **Gỡ**. Hiện "Bot gửi 4 ảnh đầu, 2 ảnh sau thành link" khi số ảnh lớn hơn `max_images_per_answer` |
| Tải lên | Thu nhỏ và nén ngay trên trình duyệt (quyết định 9), tải lên `kb_images/{slug}/…`, lấy download URL. Ảnh chỉ được ghi vào mục khi bấm **Lưu**. Bấm Hủy thì tệp đã tải lên nằm lại trong Storage (dọn sau) |
| Mục mới | Phải có `slug` hợp lệ trước khi thêm ảnh (đường dẫn ảnh theo slug) |
| Cài đặt | Thêm ô `max_images_per_answer` (0-10) |
| Thống kê | Thêm "Ảnh đã gửi" trong tháng; ô "Tin đã gửi" đã gồm cả ảnh |

## 5. Quy tắc

**Firebase Storage (`storage.rules`, tệp mới):**
- Chỉ UID có trong Firestore `admins` mới được ghi vào `kb_images/**`. Storage rules đọc được Firestore qua `firestore.exists`.
- Chỉ nhận ảnh `image/jpeg`, `image/png`, `image/webp`, tối đa 5 MB.
- Không sửa đè, không xóa từ trình duyệt.
- **Đọc:** chỉ qua download URL có token, là link bot gửi cho Zalo. Danh sách tệp không đọc được từ ngoài.

**Firestore (`firestore.rules`):**
- Cho phép admin ghi `images` (mảng tối đa 10 phần tử).
- Bỏ điều kiện cũ "không đổi `image_urls`" và bỏ yêu cầu `image_urls == []` khi tạo mục.

**Script `scripts/kb`:**
- `kb-import` **không đụng `images`**. Nạp Excel không làm mất ảnh đã tải từ trang.
- `kb-export` thêm cột chỉ đọc `so_anh` (số ảnh) để biết mục nào đã có ảnh.

## 6. Tiêu chí E

| # | Tiêu chí | Cách kiểm tra |
|---|---|---|
| E1 | Tải 3 ảnh vào một mục, lưu, hỏi trong nhóm: nhận tin chữ rồi 3 ảnh đúng thứ tự, đúng chú thích | Thử thật (điện thoại) |
| E2 | Mục có 6 ảnh, `max_images_per_answer` = 4: nhận 4 ảnh, tin chữ có link ảnh 5 và 6 | Thử thật |
| E3 | `usage.messages_sent` tăng đúng 1 + số ảnh; `photos_sent` khớp | Đối chiếu |
| E4 | Hạn mức sắp hết (đặt `monthly_message_limit` thấp): chỉ gửi tin chữ, ảnh thành link; không vượt hạn mức | Thử |
| E5 | Một ảnh hỏng (link sai): các ảnh khác vẫn gửi, có ghi lỗi | Kiểm thử đơn vị + thử |
| E6 | Người ngoài `admins` không tải ảnh lên được; tệp không phải ảnh hoặc > 5 MB bị chặn | Kiểm thử quy tắc trên emulator |
| E7 | `kb-import` nạp lại Excel không làm mất ảnh của mục | Thử |
| E8 | Ảnh 5 MB chụp màn hình được thu còn dưới 1 MB trước khi tải lên | Thử trên trang |
| E9 | Đổi thứ tự hoặc gỡ ảnh ở mục đã duyệt: phải xác nhận, `version` tăng | Thử |
| E10 | `duration_ms` với 4 ảnh; Zalo không gửi lại yêu cầu | Nhật ký vài ngày |

**Cổng duyệt E:** bạn đồng ý ảnh hiện đúng trên điện thoại và mức tốn tin thực tế.

## 7. Việc của bạn

| Việc | Khi nào |
|---|---|
| Duyệt spec này, đặc biệt quyết định 2 (vùng bucket, **không đổi được sau khi tạo**), 4, 6, 10 | Trước khi làm |
| Bật **Storage** trong Firebase Console (Build > Storage > Get started), chọn vùng theo quyết định 2, chế độ production | Trước khi triển khai |
| Đối chiếu giá Storage trên trang giá Firebase | Trước khi bật |

## 8. Quy tắc cho Claude Code

- Giữ quyết định 1 của spec A–D: AI chỉ chọn mục. Ảnh lấy từ mục đã `approved`, AI không chọn ảnh.
- Viết và kiểm thử trên emulator, gồm cả Storage emulator. Không triển khai khi chưa được bạn đồng ý.
- Không ghi token, khóa, mã nhóm, dữ liệu thật vào mã nguồn, Git hay nhật ký. Ảnh thật không đưa vào Git.
- Không xóa tệp trong Storage, không xóa dữ liệu Firestore.
- Báo cáo: tiêu chí đạt hay chưa, điều khác với tài liệu Zalo hoặc Firebase, số tin và dung lượng thực tế.

## 9. Kết quả thực hiện (16/11/2026)

### 9.1 Đã làm

| Phần | Tệp | Kiểm thử |
|---|---|---|
| Gửi ảnh sau tin chữ, ảnh thừa thành link, kiểm hạn mức, ảnh lỗi gửi tiếp, bộ đếm | `functions/src/webhook.ts`, `kb.ts`, `store.ts`, `config.ts` | 127 kiểm thử hàm đạt (thêm 18 cho bước E) |
| Form mục: thêm ảnh, dán Ctrl+V, thu nhỏ 1.600 px JPEG 85%, đổi thứ tự, chú thích, gỡ; Cài đặt `max_images_per_answer`; ô "Ảnh đã gửi" | `admin/index.html` | 45 kiểm thử logic đạt; chạy thử trên emulator |
| Quy tắc Storage (tệp mới) và Firestore (`images`, `max_images_per_answer`) | `storage.rules`, `firestore.rules`, `firebase.json` | 79 kiểm thử quy tắc trên emulator đạt |
| `kb-import` không đụng `images`; `kb-export` thêm cột `so_anh` | `scripts/kb/lib/db.mjs`, `excel.mjs`, `plan.mjs` | 50 kiểm thử script đạt |

### 9.2 Tiêu chí

| # | Kết quả |
|---|---|
| E1, E2, E3, E4, E5 | Đạt trên kiểm thử đơn vị (Zalo giả). **Chưa thử thật** |
| E6 | Đạt trên emulator |
| E7 | Đạt trên kiểm thử script (Firestore giả). Chưa thử với kho thật |
| E8 | Trên emulator: ảnh 3000×2000 thành 1600×1067. Chưa thử với ảnh chụp màn hình 5 MB thật |
| E9 | Đạt trên kiểm thử logic và emulator: đổi thứ tự ở mục đã duyệt hiện ô xác nhận, `version` 1 → 2 |
| E10 | Chưa đo (cần chạy thật) |

### 9.3 Khác với spec

- **`image_urls` vẫn không sửa được** từ trang (spec mục 5 nói bỏ điều kiện này). Mình giữ lại vì không ai cần ghi trường cũ, và giữ thì chặt hơn. Khi tạo mục, `image_urls` được phép vắng mặt; nếu có thì phải rỗng.
- **Storage coi tải lên đúng đường dẫn đã có là `create`**, không phải `update`. Quy tắc phải thêm `resource == null` mới chặn được ghi đè (kiểm thử emulator phát hiện).
- **Chú thích tự đặt dùng tổng số ảnh của mục**: mục 6 ảnh, gửi 4 thì chú thích là "Bước 1/6"…"Bước 4/6", link là "Ảnh 5", "Ảnh 6".
- **Trên emulator, link ảnh là `http://127.0.0.1:9199/...`**: trang chỉ nhận link không phải https khi chạy ở chế độ emulator. Bot luôn bỏ ảnh có link không phải https.
- Thêm các ràng buộc ngoài spec: Storage chỉ nhận tên tệp dạng `<mã>.jpg|png|webp` và slug hợp lệ; trang chặn ảnh không thuộc `kb_images/{slug}/` của chính mục.

### 9.4 Việc còn lại trước khi dùng thật

1. ~~Bật Storage~~: bạn đã bật. Tên bucket khớp `storageBucket` trong `admin/index.html`.
2. ~~Triển khai~~: xong 16/11/2026 (`storage`, `firestore`, `functions`). Còn tải `admin/index.html` lên kho `zalo-bot-admin`.
3. Thử E1-E5, E7-E10 thật. Đặc biệt xác nhận Zalo nhận được link tải của Firebase Storage (mới thử ảnh trên GitHub Pages).
