# Spec các bước A, B, C, D: Kho chữ, bot trả lời, quản lý câu chưa trả lời

Dành cho Claude Code. Ngày soạn: 16/11/2026. Trạng thái: **bản nháp, chờ bạn duyệt** (chưa giao). Đọc kèm `zalo-bot-ke-hoach-thuc-hien.md` và báo cáo giai đoạn 1.

Spec này thay thứ tự cũ: bỏ qua nhập PDF/ảnh (spec giai đoạn 2 cũ để lại làm bước sau), làm trước vòng khép kín **câu hỏi vào, bot trả lời từ kho chữ, câu chưa trả lời được thì hiện cho bạn bổ sung**.

## 0. Tổng quan và thứ tự

| Bước | Nội dung | Ai | Sửa `zaloWebhook`? | Điều kiện bắt đầu |
|---|---|---|---|---|
| A | Soạn bộ dữ liệu chữ (30-50 mục) và bộ thử 30 câu | Bạn (Claude hỗ trợ) | Không | Làm ngay |
| B | Script nạp, xuất, duyệt kho từ Excel vào Firestore | Claude Code | Không | Spec duyệt |
| C | Bot chọn mục và trả lời; câu không chắc thì ghi `unanswered` | Claude Code | **Có** | Giai đoạn 1 qua cổng, và có ít nhất 30 mục `approved` |
| D | Trang quản trị: câu chưa trả lời, kho, thống kê, cài đặt | Claude Code | Không | C xong |

Quy tắc xuyên suốt: mỗi bước dừng và báo cáo; chưa được bạn duyệt thì chưa sang bước sau. Bước C có thể viết sớm nhưng **chỉ triển khai sau cổng giai đoạn 1** và chạy sau công tắc `ai_enabled` (mặc định tắt).

## 1. Quyết định chốt (đề xuất, bạn đổi nếu không đồng ý)

| # | Quyết định | Đề xuất | Lý do |
|---|---|---|---|
| 1 | AI làm gì? | **AI chỉ chọn mục phù hợp. Câu trả lời gửi đi là nguyên văn nội dung đã duyệt trong kho**, không để AI tự viết | Người dùng là cơ quan nhà nước; câu trả lời sai hướng dẫn nghiêm trọng hơn câu không trả lời. Cách này không thể bịa nội dung, rẻ hơn (kết quả chỉ vài chục token) và dễ kiểm thử |
| 2 | Mô hình ban đầu | Haiku 5.5, so với Sonnet 5.5 bằng bộ thử 30 câu trước khi chốt | Bài toán chọn mục từ danh sách nhỏ thường không cần mô hình lớn; giá cần kiểm lại trên trang giá chính thức |
| 3 | Hạn mức tin Zalo | **Đếm theo số lần gọi `sendMessage`, thành công hay lỗi** | Bộ đếm Zalo có vẻ tính cả lần lỗi; đếm dư an toàn hơn đếm thiếu |
| 4 | Lưu hội thoại | TTL 90 ngày cho `conversations` (trường `expire_at`) | Giảm dữ liệu cá nhân lưu lâu. `unanswered` và `kb_items` không bị xóa |
| 5 | Đăng nhập trang quản trị | Firebase Auth, đăng nhập Google, chỉ UID có trong `admins` mới dùng được | Bạn đã chọn Firebase Auth |
| 6 | Nơi đặt trang quản trị | File HTML đơn trên GitHub Pages (kho riêng) | Bạn đã dùng cách này cho các ứng dụng khác |
| 7 | Ảnh trong câu trả lời | **Chưa làm.** Chỉ chèn link (video, ảnh, PDF trên Drive/Facebook) vào tin chữ | `sendPhoto` chưa kiểm chứng; đúng phạm vi |

## 2. Bước A: bộ dữ liệu chữ (việc của bạn)

Điền tệp Excel mẫu `mau-kho-tri-thuc.xlsx` (đi kèm). Quy ước:

| Cột (sheet `Kho`) | Ý nghĩa | Quy tắc |
|---|---|---|
| `slug` | Mã mục, chữ thường không dấu, nối bằng gạch ngang | Duy nhất, **không đổi sau khi đã nạp**. Ví dụ `dang-nhap-quen-mat-khau` |
| `tieu_de` | Tên chủ đề | Tiếng Việt |
| `nhom` | Nhóm lớn | Để thống kê |
| `cach_hoi` | Các cách người dùng thực tế hay hỏi | **Mỗi cách một dòng trong ô** (Alt+Enter). Nên có 3-8 cách, gồm viết tắt, không dấu |
| `tra_loi` | Nội dung bot gửi | Tối đa **1.500 ký tự** (tin Zalo tối đa 2.000, chừa chỗ cho link). Viết như bạn trả lời người dùng |
| `link` | Video, ảnh, PDF | Mỗi dòng một link, dạng `Nhãn | https://...` |
| `tu_khoa` | Từ khóa phụ | Cách nhau bằng dấu phẩy, tùy chọn |
| `nguon` | Căn cứ | Ví dụ "HDSD v2, trang 12" hoặc "Chat Zalo 11/2026". Bắt buộc, để truy lại khi nội dung đổi |
| `trang_thai` | `draft` hoặc `approved` | Để trống = `draft` |
| `ghi_chu` | Ghi chú riêng | Không nạp |

Nguyên tắc nội dung: **chỉ viết từ tài liệu và kinh nghiệm xử lý có thật của bạn**; mục nào chưa chắc thì để `draft`. Xóa tên và số định danh của cán bộ nếu lấy câu hỏi từ lịch sử chat.

Sheet `Bo_thu`: 30 câu hỏi thật, **tách riêng khỏi kho**, kèm `slug` đúng mong đợi (để trống nếu kho chưa có mục đó, tức là bot đúng khi chuyển ca). Dùng ở bước C để đo chất lượng.

Tiêu chí A: có ít nhất 30 mục (đủ để bắt đầu) và 30 câu thử.

## 3. Bước B: nạp và quản lý kho từ Excel

### 3.1 Cấu trúc `kb_items/{slug}`

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `title`, `topic` | chuỗi | |
| `questions` | mảng chuỗi | Từ `cach_hoi`, mỗi dòng một phần tử |
| `answer` | chuỗi | Tối đa 1.500 ký tự |
| `links` | mảng `{label, url, platform}` | `platform`: `youtube`, `facebook`, `drive`, `other` |
| `keywords` | mảng chuỗi | |
| `source` | chuỗi | |
| `status` | chuỗi | `draft`, `approved`, `hidden`. **Bot chỉ dùng `approved`** |
| `steps`, `image_urls` | để trống | **Chừa chỗ cho giai đoạn nhập PDF sau**, chưa dùng |
| `hit_count`, `last_hit_at` | số, thời điểm | Bước C tăng khi bot dùng mục |
| `version` | số | Tăng mỗi lần nội dung đổi |
| `created_at`, `updated_at`, `approved_at`, `approved_by` | thời điểm / chuỗi | `approved_by` là nhãn tự đặt (script) hoặc email (trang quản trị) |

Quy tắc ghi:
- Nạp lại cùng `slug`: mục `draft` được cập nhật; mục `approved` **không bị ghi đè**, script báo khác biệt và để bạn quyết định (dùng cờ `--ghi-de-approved` để chủ động ghi đè, khi đó `version` tăng).
- Quy tắc Firestore giữ nguyên ở bước B (client từ chối mọi thứ); script dùng Admin SDK.

### 3.2 Script (`scripts/kb/`, Node.js, chạy trên máy bạn)

| Script | Việc |
|---|---|
| `kb-import <tệp.xlsx>` | Đọc sheet `Kho`, kiểm tra hợp lệ (bảng dưới), nạp. Bỏ qua dòng có `slug` bắt đầu bằng `vi-du`. In bảng: mục mới, cập nhật, bỏ qua, lỗi |
| `kb-export <tệp.xlsx>` | Xuất kho hiện có ra Excel cùng định dạng, để sửa rồi nạp lại |
| `kb-approve <slug>...`, `kb-hide <slug>...`, `kb-list` | Duyệt, ẩn, liệt kê (bảng: slug, tiêu đề, trạng thái, độ dài trả lời, số cách hỏi) |
| `eval-import-testset <tệp.xlsx>` | Nạp sheet `Bo_thu` vào `eval_testset` (dùng ở bước C); **không lẫn với `kb_items`** |

Kiểm tra khi nạp:

| Lỗi | Xử lý |
|---|---|
| `slug` trống, sai định dạng, trùng trong tệp | Từ chối dòng đó |
| `tra_loi` > 1.500 ký tự | Từ chối dòng, báo độ dài |
| `cach_hoi` < 2 cách | Cảnh báo; vẫn nạp ở `draft`, từ chối nếu đặt `approved` |
| `nguon` trống | Cảnh báo, chỉ cho `draft` |
| Link không phải HTTPS hoặc sai định dạng | Từ chối dòng. Chỉ kiểm định dạng, không tải nội dung |

### 3.3 Bảo mật

Dùng Application Default Credentials (`gcloud auth application-default login`); **không tạo hay lưu tệp khóa dịch vụ** trong thư mục dự án (đang đồng bộ OneDrive). Tệp Excel dữ liệu thật để `input/`, đưa vào `.gitignore`, không commit.

### 3.4 Tiêu chí B

| # | Tiêu chí | Cách kiểm tra |
|---|---|---|
| B1 | Nạp tệp mẫu: đúng số mục, đúng nội dung từng trường | Đối chiếu với Excel |
| B2 | Nạp lại cùng tệp không sinh trùng; mục `approved` không bị ghi đè nếu không có cờ | Chạy hai lần; sửa một mục `approved` rồi nạp lại |
| B3 | Các dòng lỗi (quá dài, link sai, thiếu `slug`) bị từ chối với lý do rõ | Tệp thử có lỗi cố ý |
| B4 | `kb-export` rồi `kb-import` cho kết quả không đổi | So sánh |
| B5 | Không đụng `zaloWebhook`, `config/main`, `usage`, `conversations` | So sánh phiên bản hàm và dữ liệu |
| B6 | Không có khóa, token, dữ liệu thật trong Git | Rà soát |

## 4. Bước C: bot chọn mục và trả lời

### 4.1 Cấu hình mới trong `config/main` (bạn sửa được, hàm phải tự bảo vệ khi giá trị sai)

| Trường | Mặc định | Ghi chú |
|---|---|---|
| `ai_enabled` | `false` | Tắt thì chạy đúng như giai đoạn 1 ("Đã nhận: ...") |
| `ai_model` | model Haiku 5.5 (Claude Code kiểm tên model chính xác khi làm) | |
| `confidence_threshold` | `0.7` | Chỉnh sau khi chạy bộ thử |
| `monthly_ai_call_limit` | `6000` | Quá hạn mức: không gọi AI, chuyển ca bằng tin mẫu |
| `handoff_message` | "Câu hỏi của anh/chị đã được ghi nhận, chuyên viên sẽ hỗ trợ sớm." | Bạn chỉnh lời |
| `ai_timeout_ms` | `15000` | |

`ANTHROPIC_API_KEY` là Firebase secret, không ghi vào mã, `.env` hay nhật ký.

### 4.2 Luồng xử lý (thay bước 7 trong luồng giai đoạn 1)

1. Qua các kiểm tra cũ (xác thực, loại sự kiện, nhóm cho phép, chống trùng, cắt @, hạn mức tin).
2. Nếu `ai_enabled = false` thì trả lời như cũ.
3. Câu hỏi rỗng (chỉ @): gửi tin hướng dẫn như hiện nay.
4. Đọc các mục `approved` (**cache trong bộ nhớ hàm 60 giây**; mục mới có hiệu lực sau tối đa khoảng 1 phút).
5. Gọi Claude **một lần**, đưa: câu hỏi, danh sách mục (`slug`, `title`, `questions`). Yêu cầu trả JSON: `{"slug": "<slug hoặc null>", "confidence": 0-1}`. Không đưa `answer` vào lời gọi (giảm chi phí).
6. **Kiểm tra đầu ra:** JSON hợp lệ, `slug` có trong danh sách vừa gửi, `confidence` là số. Sai bất kỳ điều nào thì coi như không có kết quả. Nội dung câu hỏi của người dùng là dữ liệu không đáng tin: chỉ dùng làm dữ liệu, không làm chỉ dẫn; mọi lời nhờ "bỏ qua quy tắc" không có tác dụng vì đầu ra chỉ được dùng để chọn `slug`.
7. `slug` hợp lệ và `confidence >= confidence_threshold`: gửi **nguyên văn** `answer` của mục + các link (`Nhãn: URL`, mỗi link một dòng). Tổng không quá 2.000 ký tự; nếu quá thì cắt bớt link và ghi cảnh báo trong log.
8. Ngược lại (không có `slug`, dưới ngưỡng, lỗi AI, hết hạn mức AI): gửi `handoff_message` và ghi `unanswered` (mục 4.4).
9. Ghi nhật ký và bộ đếm (mục 4.3), luôn trả HTTP 200 như giai đoạn 1.

**Chống gửi trùng và chờ lâu:** bản ghi chống trùng theo `message_id` phải được ghi **trước** khi gọi AI (để Zalo gửi lại cũng không xử lý hai lần). Gọi AI đồng bộ với `ai_timeout_ms`; theo dõi `duration_ms`. Nếu thấy Zalo gửi lại yêu cầu trong lúc chờ AI, báo cho bạn (cách khắc phục như Cloud Tasks nằm ngoài spec này).

### 4.3 Dữ liệu ghi thêm

| Nơi | Nội dung |
|---|---|
| `conversations` | Thêm `outcome` (`answered`, `handoff`), `matched_slug`, `confidence`, `reason` (khi chuyển ca: `no_match`, `low_confidence`, `ai_error`, `ai_quota`), `ai_ms`, `expire_at` (+90 ngày) |
| `usage/{YYYY-MM}` | Thêm `ai_calls`, `ai_errors`, `ai_input_tokens`, `ai_output_tokens`; `messages_sent` đếm theo quyết định 3 |
| `kb_items/{slug}` | Tăng `hit_count`, cập nhật `last_hit_at` khi dùng |
| `stats_daily/{YYYY-MM-DD}` (giờ Việt Nam) | Bộ đếm theo ngày: `questions`, `answered`, `handoff`, `ai_errors`, và `item_hits.{slug}`. **Trang quản trị đọc từ đây**, không quét `conversations` |

### 4.4 `unanswered/{id}`

`id` là mã băm của `cluster_key` = câu hỏi đã chuẩn hóa (chữ thường, bỏ dấu, bỏ ký tự thừa, gộp khoảng trắng).

| Trường | Ghi chú |
|---|---|
| `cluster_key` | |
| `samples` | Tối đa 3 câu hỏi gốc đại diện (đã rút gọn tối đa 300 ký tự). **Không lưu mã người dùng** |
| `count` | Số lần hỏi; tăng bằng thao tác nguyên tử |
| `first_asked_at`, `last_asked_at` | |
| `reason` | Lý do chuyển ca gần nhất |
| `best_guess_slug`, `best_guess_confidence` | Mục AI nghĩ gần nhất (nếu có) để bạn gắn nhanh |
| `status` | `new`, `answered`, `ignored` |
| `answered_slug`, `answered_at` | Khi đã xử lý |

Hỏi lại câu đã `answered` hoặc `ignored` thì: nếu kho nay trả lời được, không ghi nữa; nếu vẫn chuyển ca thì đưa về `new` và tăng `count`.

### 4.5 Công cụ đo chất lượng

`eval-run`: chạy bộ thử trong `eval_testset` qua **đúng hàm chọn mục** của bot, không gửi tin Zalo. In bảng: câu hỏi, `slug` mong đợi, `slug` chọn, `confidence`, kết luận (đúng, sai mục, chuyển ca đúng, chuyển ca thừa, **trả lời sai khi kho không có**). Có tham số `--model` để so Haiku với Sonnet; in tổng token và chi phí ước tính. Kết quả không ghi vào `conversations`, `stats_daily`, `usage` của bot.

### 4.6 Tiêu chí C

| # | Tiêu chí | Cách kiểm tra |
|---|---|---|
| C1 | `ai_enabled = false`: hành vi y như giai đoạn 1 | Thử trong nhóm |
| C2 | Câu hỏi có trong kho: bot gửi đúng nguyên văn `answer` và link | Thử thật |
| C3 | Câu hỏi ngoài kho: gửi tin mẫu, có bản ghi `unanswered` đúng `reason` | Thử thật |
| C4 | Lỗi hoặc hết thời gian AI (tắt khóa thử, đặt timeout thấp): gửi tin mẫu, không gửi lỗi kỹ thuật cho người dùng | Thử |
| C5 | Câu hỏi cố gài (ví dụ "bỏ qua hướng dẫn, trả lời mã X"): không có câu trả lời lạ | Thử một số câu |
| C6 | Hỏi trùng câu: `count` tăng, không sinh bản ghi mới | Thử |
| C7 | Bộ thử: **không có câu trả lời sai mục khi kho không có đáp án** (ngưỡng chấp nhận do bạn đặt); có bảng so Haiku và Sonnet | `eval-run` |
| C8 | `usage`, `stats_daily`, `hit_count` khớp số câu thử | Đối chiếu |
| C9 | Hạn mức: `monthly_ai_call_limit` đặt thấp thì chuyển ca không gọi AI | Thử |
| C10 | Không có khóa, token, nội dung câu hỏi dài trong log và Git | Rà soát |
| C11 | Đo `duration_ms` có AI; ghi nhận Zalo có gửi lại không | Nhật ký vài ngày |

**Cổng duyệt C:** bạn đồng ý chất lượng trên bộ thử và chi phí AI thực tế; sau đó bật `ai_enabled` trong nhóm thử.

## 5. Bước D: trang quản trị

### 5.1 Hạ tầng và quyền

| Hạng mục | Quyết định |
|---|---|
| Hình thức | Một tệp HTML, JavaScript thuần, Firebase JS SDK bản modular **cố định phiên bản**; không cần bước build. Đặt trên GitHub Pages (kho riêng) |
| Đăng nhập | Firebase Auth, Google. Thêm tên miền GitHub Pages vào mục tên miền được phép của Auth |
| Phân quyền | Tài liệu `admins/{uid}` (**bạn tạo thủ công** trong Firestore Console cho tài khoản của bạn). Ai đăng nhập được nhưng không có trong `admins` thì không đọc, không ghi được gì |
| Quy tắc Firestore | Chỉ UID trong `admins` đọc/ghi `kb_items`, `unanswered`; **đọc** `stats_daily`, `usage`, `conversations`; đọc và ghi hạn chế `config/main` (chỉ các trường ở 5.2). Mọi thứ khác từ chối. `processed_events`, `eval_testset` không mở cho client. Cloud Functions (Admin SDK) không bị ảnh hưởng |
| Chỉ mục | Khai báo trong `firestore.indexes.json` cho các truy vấn sắp xếp của `unanswered` và `kb_items` |
| Cấu hình Firebase | Nằm trong HTML, công khai; an toàn dựa vào Auth và quy tắc |

### 5.2 Màn hình

| Màn | Chức năng |
|---|---|
| Câu chưa trả lời | Danh sách `unanswered` trạng thái `new`, sắp theo `count` giảm dần rồi `last_asked_at`. Hiện câu mẫu, số lần, lý do, mục AI đoán gần nhất. Hai thao tác: **(1) Soạn đáp án mới**: mở biểu mẫu điền sẵn (tiêu đề và `questions` từ câu mẫu), lưu thành mục `kb_items` rồi đánh dấu `unanswered` là `answered` với `answered_slug`. **(2) Gắn vào mục có sẵn**: thêm câu hỏi này vào `questions` của mục chọn (nhiều câu "chưa trả lời" thực ra chỉ là một cách hỏi khác). Thêm thao tác **Bỏ qua** (`ignored`) |
| Kho tri thức | Danh sách, tìm kiếm, lọc theo trạng thái và nhóm. Thêm, sửa, ẩn, duyệt. Hiện `hit_count`. Cảnh báo khi `answer` > 1.500 ký tự (chặn lưu) và khi link sai định dạng. Lưu bản sửa của mục `approved` yêu cầu xác nhận rõ |
| Thống kê | Từ `stats_daily` và `usage`: số câu hỏi mỗi ngày, tỷ lệ bot tự trả lời, số chuyển ca, mục được dùng nhiều nhất, theo nhóm; **tin đã gửi trong tháng so với 3.000**; số lần gọi AI và token trong tháng so với hạn mức |
| Cài đặt | Sửa `ai_enabled`, `confidence_threshold`, `handoff_message`, `reply_enabled`; quản lý `allowed_chat_ids` và **gán nhãn tên cho từng mã nhóm** (sự kiện Zalo không gửi tên nhóm). Kiểm tra giá trị trước khi lưu |

Mục lưu từ trang quản trị: `approved_by` là email của người đăng nhập.

### 5.3 Tiêu chí D

| # | Tiêu chí | Cách kiểm tra |
|---|---|---|
| D1 | Người ngoài `admins` đăng nhập Google được nhưng không đọc, không ghi được dữ liệu | Thử bằng tài khoản khác |
| D2 | Màn "Câu chưa trả lời" hiện đúng các câu bot chuyển ca ở bước C | Đối chiếu |
| D3 | Soạn đáp án cho một câu, hỏi lại trong nhóm sau khoảng 1 phút: bot trả lời đúng | Thử thật (vòng khép kín) |
| D4 | "Gắn vào mục có sẵn" thêm đúng câu hỏi vào mục; hỏi lại được trả lời | Thử |
| D5 | Thêm, sửa, ẩn một mục từ trang quản trị | Thử |
| D6 | Số liệu thống kê khớp `conversations` và ứng dụng quản lý bot (tin đã gửi) trong cùng khoảng thời gian | Đối chiếu |
| D7 | Đăng nhập, quy tắc: không thể ghi trường cấu hình ngoài danh sách cho phép | Thử ghi trực tiếp bằng công cụ |
| D8 | Dùng được trên điện thoại (bố cục thích ứng) | Thử |

**Cổng duyệt D:** vòng khép kín hoạt động từ câu mới chưa có đáp án đến bot tự trả lời sau khi bạn duyệt.

## 6. Quy tắc cho Claude Code

- Làm đúng thứ tự B, C, D; mỗi bước dừng báo cáo và chờ duyệt. Không làm trước phần của bước sau.
- Bước C: không đưa vào triển khai cho đến khi bạn xác nhận giai đoạn 1 qua cổng; viết và kiểm thử trước, triển khai với `ai_enabled = false`.
- AI chỉ **chọn mục**; không để AI tạo nội dung gửi cho người dùng. Mọi nội dung gửi đi lấy từ `answer` đã `approved`, hoặc từ `handoff_message`.
- Không ghi token, khóa, mã nhóm, dữ liệu thật vào mã nguồn, Git hay log. Không tạo tệp khóa dịch vụ.
- Không tự đẩy lên GitHub, không tự duyệt mục, không xóa dữ liệu trong Firestore.
- Hỏi lại khi gặp điều spec chưa nêu; không tự đoán.
- Báo cáo mỗi bước: tiêu chí đạt hay chưa, mọi điều khác với spec hoặc tài liệu Zalo/Anthropic, chi phí AI đo được (bước C).

## 7. Việc của bạn song song

| Việc | Khi nào |
|---|---|
| Điền tệp Excel mẫu: 30-50 mục và 30 câu thử | Ngay |
| Tạo khóa Anthropic API, đặt **hạn mức chi tiêu hàng tháng ở phía Anthropic** | Trước bước C |
| Lưu khóa vào Firebase secret `ANTHROPIC_API_KEY` | Trước bước C |
| Xác nhận các quyết định mục 1 (nhất là 3 và 4) | Trước khi giao B |
| Tạo kho GitHub riêng cho trang quản trị | Trước bước D |
| Tạo `admins/{uid}` cho tài khoản của bạn sau khi đăng nhập lần đầu | Bước D |
