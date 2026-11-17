# Spec bước G: Màn "Lịch sử hỗ trợ" trên trang quản trị

Trạng thái: **đã duyệt 17/11/2026 (10b; thông tin cá nhân mặc định ẩn).**

## 0. Căn cứ và phạm vi

- Dữ liệu đã có sẵn: webhook ghi `conversations/{message_id}` cho mọi tin trong nhóm được phép, giữ 90 ngày rồi Firestore tự xóa (TTL `expire_at`). Quy tắc hiện tại đã cho quản trị đọc (`allow read: if isAdmin()`).
- Trang quản trị chưa có màn nào đọc `conversations`. Màn "Câu chưa trả lời" chỉ có các cụm câu bị chuyển ca, không có câu đã trả lời được, nội dung bot đã gửi hay thời điểm từng lần.
- Bước G **chỉ thêm màn đọc** vào `admin/index.html`, thêm chỉ mục Firestore và kiểm thử. Không đổi cách webhook trả lời, không gọi AI, không tốn thêm tiền ngoài lượt đọc Firestore.

Mỗi bản ghi đang có: `created_at`, `chat_id`, `from_id`, `display_name`, `question`, `reply_text`, `outcome` (`answered`/`handoff`/`replied`/`error`/`ignored`), `ignore_reason`, `error`, `duration_ms`; khi đi qua AI có thêm `matched_slug`, `confidence`, `reason`, `ai_ms`, `send_ok`; có ảnh trả lời thì có `images_sent`, `image_errors`, `images_as_links`; tin ảnh (bước F) thì có `source: "image"`, `image_summary`, `image_bytes`, `image_type`, `fetch_ms`.

## 1. Quyết định chốt (đề xuất, bạn đổi nếu không đồng ý)

1. Thêm tab **"Lịch sử"**, đặt sau "Câu chưa trả lời".
2. Màn Lịch sử **chỉ hiện tin có gọi tên bot** (chốt 17/11/2026). Gồm `answered`, `handoff`, `replied`, `error`, và các tin gọi tên bot mà bot không trả lời: `ignored` với lý do `reply_disabled` (tắt trả lời), `quota` (hết hạn mức tin), `image_ai_disabled` (ảnh khi chưa bật đọc ảnh). Tin không gọi tên bot (`no_mention`), sự kiện lạ, tin ngoài nhóm **không bao giờ hiện**.
3. Bộ lọc kết quả: *Tất cả* / *Trả lời được* (`answered`, `replied`) / *Chuyển ca* (`handoff`) / *Lỗi* (`error`, hoặc `send_ok == false`) / *Bot không trả lời* (ba lý do `ignored` ở trên).
4. Bộ lọc nhóm (theo `chat_labels`, như màn Cài đặt) và khoảng thời gian: Hôm nay, 7 ngày, 30 ngày, 90 ngày. Mặc định 7 ngày.
5. Tải 50 dòng mỗi lần, mới nhất trước, nút "Tải thêm". Ô tìm chữ chỉ lọc trong các dòng đã tải (không tìm toàn bộ cơ sở dữ liệu, vì Firestore không hỗ trợ tìm chữ).
6. Mỗi dòng hiện: thời gian (giờ Việt Nam), nhóm, **tên hiển thị** người hỏi, câu hỏi, chip kết quả, mục đã chọn (tên mục + độ tin cậy), lý do chuyển ca (dùng nhãn của màn "Câu chưa trả lời"), chip "Ảnh" kèm mô tả AI nếu là tin ảnh, số ảnh đã gửi kèm câu trả lời, lỗi gửi nếu có.
7. Bấm vào dòng để mở **nội dung bot đã gửi** (`reply_text`, đầy đủ), thời gian xử lý (`duration_ms`, `ai_ms`, `fetch_ms`) và nút "Mở mục" sang màn Kho kiến thức. Không hiện `from_id`.
8. Đầu màn có dòng tóm tắt cho các dòng đã tải: tổng, trả lời được, không trả lời được, lỗi. Số liệu đầy đủ theo ngày vẫn ở màn Thống kê.
7b. Phần mở rộng của mỗi dòng chia ba khối, theo yêu cầu 17/11/2026:
    - **Người dùng đã nhắn:** tên hiển thị, nhóm, thời gian, nguyên văn câu hỏi (với tin ảnh là chú thích).
    - **Thông tin đọc từ ảnh** (chỉ tin ảnh): mô tả ngắn và nội dung đọc được (xem mục 11), loại ảnh, dung lượng.
    - **Bot đã hỗ trợ:** kết quả, mục đã chọn và độ tin cậy, nguyên văn câu trả lời đã gửi, số ảnh đã gửi kèm. Nếu bot chuyển ca thì hiện lý do và tin chuyển ca đã gửi.
9. Không xóa, không sửa bản ghi từ màn này. Không xuất tệp (CSV) ở bước G; làm sau nếu cần.
10. **Tin không gọi tên bot** (chốt 10b, 17/11/2026): giữ cách lưu hiện tại, không đổi webhook. Màn Lịch sử không truy vấn và không hiện các tin này.
11. **Đọc nội dung ảnh đầy đủ hơn.** Hiện AI chỉ trả `mo_ta`: một câu, tối đa 200 ký tự. Đề xuất thêm trường `noi_dung_anh` vào đầu ra JSON của lượt đọc ảnh: chữ và thông báo lỗi đọc được trên ảnh (tên màn hình, nút, dòng báo lỗi, mã lỗi), tối đa 1.000 ký tự, được nhiều dòng. Lưu vào `conversations.image_text`, chỉ quản trị xem, không bao giờ gửi vào Zalo.
    - Thông tin cá nhân (chốt 17/11/2026): **mặc định ẩn, quản trị bấm để xem.**
      - Trong `noi_dung_anh`, AI chép nguyên văn nhưng bọc mỗi thông tin cá nhân (tên người, số điện thoại, số CCCD, mã hồ sơ, địa chỉ, email, ngày sinh) trong cặp dấu `⟦…⟧`. Ví dụ: `Hồ sơ ⟦H12.34-251117-0001⟧ của ⟦Nguyễn Văn A⟧ báo lỗi thiếu chữ ký`. `mo_ta` vẫn không được có thông tin cá nhân.
      - Màn Lịch sử hiện mỗi đoạn `⟦…⟧` thành `[đã ẩn]`. Nút "Hiện thông tin cá nhân" chỉ mở cho bản ghi đang xem; chuyển trang hay tải lại thì ẩn lại.
      - Câu hỏi bằng chữ cũng ẩn theo cùng cách. Trình duyệt tự nhận số điện thoại (10–11 chữ số, đầu 0 hoặc +84), số CCCD (12 chữ số) và email trong `question`, rồi hiện thành `[đã ẩn]`. Dữ liệu lưu không bị đổi.
      - Mỗi lần bấm "Hiện" được ghi vào `pii_views/{id}`: `conversation_id`, `viewed_by` (email quản trị), `viewed_at`. Quy tắc chỉ cho quản trị tạo bản ghi đúng email và thời gian của mình, không cho sửa hay xóa. Xem lại được ở cuối màn Lịch sử.
      - **Giới hạn cần biết:** đây là ẩn trên màn hình. Thông tin cá nhân vẫn nằm trong Firestore 90 ngày rồi tự xóa. Ai có quyền quản trị, hoặc vào Firebase Console, vẫn đọc được bản gốc. Vì vậy cần báo nhóm rằng nội dung chữ trên ảnh gửi cho bot được lưu 90 ngày để hỗ trợ.
      - Nếu AI quên bọc `⟦…⟧` thì thông tin hiện ra ngay. Trình duyệt chạy thêm cùng bộ nhận dạng số điện thoại, CCCD, email lên `image_text` để giảm rủi ro này, nhưng không bắt được tên người và địa chỉ.
    - Chi phí thêm: khoảng 300 token ra mỗi ảnh, tức khoảng 300 × 300 × 0,50 USD / 1 triệu ≈ 0,05 USD/tháng nếu dùng hết 300 lượt.
    - Chỉ áp dụng cho ảnh gửi sau khi triển khai; ảnh cũ chỉ có mô tả ngắn. Ảnh không được lưu nên không đọc lại được.
    - Có công tắc `image_text_enabled` trong Cài đặt, mặc định bật, đi cùng `image_summary_enabled`. Phải triển khai lại `zaloWebhook` và quy tắc Firestore.

## 2. Truy vấn và chỉ mục

- Truy vấn: `conversations` với `where("created_at", ">=", từ ngày)`, `where("outcome", "in", [...])` hoặc `where("ignore_reason", "in", [...])` (bộ lọc *Tất cả* dùng `or()` của hai điều kiện), có thể thêm `where("chat_id", "==", nhóm)`, `orderBy("created_at", "desc")`, `limit(50)`, phân trang bằng `startAfter`.
- Thêm vào `firestore.indexes.json` các chỉ mục ghép (`outcome`, `created_at` DESC), (`ignore_reason`, `created_at` DESC) và hai bản có thêm `chat_id` ở đầu. Triển khai bằng `firebase deploy --only firestore:indexes`; chỉ mục mới cần vài phút để dựng.
- Bộ lọc "Lỗi" lấy `outcome == "error"` từ máy chủ, cộng các dòng `send_ok == false` lọc ở trình duyệt trong dữ liệu đã tải; spec ghi rõ giới hạn này trên màn hình.
- Chi phí: mỗi lần tải 50 dòng là 50 lượt đọc Firestore, nằm trong hạn mức miễn phí (50.000 lượt/ngày).

## 3. Bảo mật

- Không đổi quy tắc đọc. Thêm kiểm thử quy tắc: người không phải quản trị và người chưa đăng nhập không đọc hay liệt kê được `conversations`; quản trị cũng không ghi hay xóa được.
- Mọi chữ từ bản ghi được hiển thị bằng `textContent` (hàm `h()` sẵn có), không dùng `innerHTML`.
- Không ghi nội dung hội thoại ra console hay log.

## 4. Tiêu chí G

- G1. Mở tab Lịch sử: thấy các lần hỗ trợ 7 ngày gần nhất, mới nhất trước, chỉ có tin gọi tên bot (kể cả tin bot không trả lời vì tắt trả lời, hết hạn mức, chưa bật đọc ảnh).
- G2. Lọc "Trả lời được" và "Không trả lời được" cho đúng tập; chip, tên mục, lý do khớp với bản ghi.
- G3. Lọc theo nhóm và theo khoảng thời gian; "Tải thêm" nối tiếp đúng, không trùng dòng.
- G4. Bấm một dòng: thấy đủ nội dung bot đã gửi; tin ảnh có chip và mô tả AI.
- G5. Chữ có thẻ HTML trong câu hỏi hiện ra nguyên văn, không chạy.
- G6. Kiểm thử quy tắc mới qua; kiểm thử logic cho hàm lọc, nhãn và tóm tắt qua.
- G7. Không tin `no_mention` nào hiện trên màn Lịch sử, kể cả khi đã tải hết.
- G8. (Mục 11) ảnh mới gửi có `image_text`, hiện trong khối "Thông tin đọc từ ảnh"; đầu ra AI sai kiểu thì bỏ trường này mà vẫn trả lời bình thường; `image_text` không bao giờ xuất hiện trong tin gửi Zalo hay trong log.
- G9. Thông tin cá nhân trong `image_text` (đoạn `⟦…⟧`) và số điện thoại, CCCD, email trong câu hỏi hiện là `[đã ẩn]`. Bấm "Hiện" thì thấy bản gốc và có một bản ghi `pii_views`. Kiểm thử quy tắc: không phải quản trị thì không tạo được, ghi email người khác thì không tạo được, không ai sửa hay xóa được.

## 5. Việc của bạn

1. Duyệt spec (đã duyệt 17/11/2026, chọn 10b).
2. Sau khi mình làm xong: đồng ý triển khai (hàm `zaloWebhook` cho mục 11, quy tắc và chỉ mục Firestore), rồi tải `admin/index.html` mới lên kho `zalo-bot-admin`.

## 6. Quy tắc cho Claude Code

- Không ghi dữ liệu hội thoại thật vào mã nguồn, kiểm thử hay Git; dữ liệu thử chỉ dùng bản giả trong `admin/test/seed-emulator.mjs`.
- Thử trên Firestore Emulator, không đọc dự án thật từ trình duyệt.
- Không xóa dữ liệu trong Firestore. Chỉ triển khai khi bạn đồng ý.

## 7. Kết quả thực hiện (17/11/2026)

### 7.1 Đã làm

- `functions/src/selector.ts`: đầu ra đọc ảnh thêm `noi_dung_anh` (khi `image_text_enabled`), lời nhắc dặn bọc thông tin cá nhân bằng `⟦…⟧`, `max_tokens` 2048 khi bật. `parseImageText`: giữ xuống dòng, bỏ ký tự điều khiển, gộp dòng trống, tối đa 1.000 ký tự, cắt giữa `⟦…⟧` thì đóng lại.
- `config.ts`: `image_text_enabled` (mặc định `true`). `webhook.ts`, `store.ts`: lưu `conversations.image_text`; không đưa vào log, tin Zalo hay `unanswered`.
- `firestore.rules`: `config/main` nhận `image_text_enabled` (bool); `pii_views` chỉ quản trị tạo, đúng email, đúng giờ máy chủ, phải trỏ tới hội thoại có thật, không sửa, không xóa.
- `firestore.indexes.json`: 6 chỉ mục `conversations` (`outcome`, `ignore_reason`, `send_ok` × có/không `chat_id`, cùng `created_at` giảm dần).
- `admin/index.html`: tab "Lịch sử", ô "Chép chữ trên ảnh" trong Cài đặt.

### 7.2 Tiêu chí

- Kiểm thử: hàm 173 (thêm 10), logic trang 63 (thêm 10), quy tắc 98 (thêm 11). Tất cả qua.
- G1-G5, G7, G9 thử trên emulator với dữ liệu giả: chỉ hiện tin gọi tên bot (tin `no_mention` giả không hiện); các bộ lọc, nhóm, hôm nay/7 ngày đúng tập; thẻ `<b>` hiện nguyên văn; ba khối chi tiết; số điện thoại và đoạn `⟦…⟧` thành `[đã ẩn]`; bấm Hiện thì thấy bản gốc và nhật ký ghi một lần xem; lưu Cài đặt có `image_text_enabled` qua quy tắc; màn rộng 375 px không tràn ngang.
- G8 kiểm bằng kiểm thử hàm. Chưa thử với ảnh thật (cần triển khai).

### 7.3 Khác với spec

- Bộ lọc khớp đúng nhãn: tin `answered` mà gửi lỗi chỉ nằm ở "Lỗi", không ở "Trả lời được".
- Ô tìm không tìm trong chữ đọc từ ảnh và phần đã ẩn, để không dò được thông tin cá nhân.
- Truy vấn "Tất cả" dùng `or()` của Firestore; dòng lạ lọt qua (nếu có) bị lọc lại ở trình duyệt.

### 7.4 Việc còn lại

1. ~~Triển khai~~ Đã triển khai 17/11/2026 (`firebase deploy --only functions:zaloWebhook,firestore`): `zaloWebhook` bản `zalowebhook-00009-zuv` khởi động bình thường, quy tắc đã phát hành, 6 chỉ mục `conversations` đã gửi lên (cần vài phút để dựng; trong lúc đó màn Lịch sử báo thiếu chỉ mục).
2. Tải `admin/index.html` lên kho `zalo-bot-admin`.
3. Báo nhóm: chữ trên ảnh gửi cho bot được lưu 90 ngày để hỗ trợ.
4. Gửi thử một ảnh có gọi tên bot, mở Lịch sử xem khối "Thông tin đọc từ ảnh" (G8 trên dữ liệu thật).
