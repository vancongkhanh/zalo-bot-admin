# Báo cáo các bước B, C, D: kho tri thức, bot trả lời, trang quản trị

Ngày: 16/11/2026. Theo spec [spec-buoc-A-B-C-D.md](../spec/spec-buoc-A-B-C-D.md). Báo cáo giai đoạn 1 nằm trong tệp Word cùng thư mục.

## 1. Tóm tắt

Vòng khép kín đã chạy trên Zalo thật, trừ khâu duyệt trên trang quản trị:

- Câu có trong kho được trả lời nguyên văn bằng mục đã duyệt.
- Câu ngoài kho được gửi tin chuyển ca và ghi vào `unanswered`.
- Trang quản trị đã lên GitHub Pages. Đăng nhập Google đã chạy; còn chờ bạn tạo `admins/{uid}` để vào dùng.

| Bước | Kết quả | Commit |
|---|---|---|
| Giai đoạn 1 | Webhook cơ bản. Bạn xác nhận qua cổng ngày 16/11 | `344e688` |
| B | Script nạp, xuất, duyệt kho từ Excel | `079dae8` |
| C | AI chọn mục, trả lời nguyên văn, chuyển ca, thống kê | `faf5f8e` |
| D | Trang quản trị và quy tắc Firestore | `435e60b` |

**Triển khai:**
- Hàm có bước C: 16/11 lúc 16:21.
- Quy tắc và chỉ mục Firestore của bước D: 16/11.
- Trang quản trị: `https://vancongkhanh.github.io/zalo-bot-admin/`.
- `ai_enabled` đang **bật**.

## 2. Bước B: kho tri thức từ Excel

Các tiêu chí B1–B6 đều đạt và được kiểm lúc giao bước B (49 kiểm thử script).

| # | Tiêu chí | Kết quả |
|---|---|---|
| B1 | Nạp đúng số mục, đúng nội dung | Đạt |
| B2 | Nạp lại không sinh trùng; mục `approved` không bị ghi đè nếu không có cờ | Đạt |
| B3 | Dòng lỗi bị từ chối kèm lý do | Đạt |
| B4 | Xuất rồi nạp lại không đổi | Đạt |
| B5 | Không đụng `zaloWebhook`, `config/main`, `usage`, `conversations` | Đạt |
| B6 | Không có khóa, token, dữ liệu thật trong Git | Đạt. `data/mau-kho-tri-thuc.xlsx` chứa dữ liệu thật nên đã đưa vào `.gitignore` |

**Bài học khi dùng:** nạp với `--ghi-de-approved` mà cột `trang_thai` để trống thì mục đang `approved` bị đưa về `draft`. Lần thử ngày 16/11 đã gặp đúng trường hợp này với `ky-so`. Cách tránh đã ghi trong [scripts/kb/README.md](../scripts/kb/README.md).

## 3. Bước C: bot chọn mục và trả lời

### 3.1 Tiêu chí

| # | Tiêu chí | Kết quả |
|---|---|---|
| C1 | `ai_enabled = false` thì chạy y như giai đoạn 1 | Kiểm thử đơn vị đạt. Chưa thử riêng trên Zalo sau khi triển khai, vì AI được bật ngay |
| C2 | Câu có trong kho: gửi nguyên văn `answer` và link | **Đạt khi chạy thật** (16:31): "tôi cần hướng dẫn ký số" → `ky-so`, độ tin cậy 0,95 |
| C3 | Câu ngoài kho: gửi tin mẫu, ghi `unanswered` đúng `reason` | **Đạt khi chạy thật**: "nộp thuế ở đâu vậy?" → chuyển ca, `reason = no_match`, `status = new` |
| C4 | Lỗi hoặc hết giờ AI thì gửi tin mẫu, không lộ lỗi kỹ thuật | Kiểm thử đơn vị đạt; chưa thử thật |
| C5 | Câu gài lệnh không cho ra câu trả lời lạ | Kiểm thử đơn vị đạt; chưa thử thật |
| C6 | Hỏi trùng thì `count` tăng, không sinh bản ghi mới | Kiểm thử đơn vị đạt; chưa thử thật |
| C7 | Bộ thử: không trả lời sai khi kho không có; có bảng so Haiku và Sonnet | **Chưa đạt đủ** (xem 3.2). Bạn quyết định tạm bỏ qua |
| C8 | `usage`, `stats_daily`, `hit_count` khớp số câu | **Đạt** (đối chiếu Firestore sau 2 câu thật) |
| C9 | Hết hạn mức AI thì chuyển ca, không gọi AI | Kiểm thử đơn vị đạt; chưa thử thật |
| C10 | Không có khóa, token, nội dung câu hỏi trong log và Git | Đạt. Có kiểm thử xác nhận nhật ký không chứa câu hỏi; Git không chứa bí mật |
| C11 | Đo `duration_ms`; xem Zalo có gửi lại không | Đã đo: AI 1,7–2,1 giây, tổng 2,3–3,4 giây. Cần theo dõi thêm vài ngày xem Zalo có gửi lại không |

**Số liệu Firestore sau hai câu thật:**
- `stats_daily`: `questions` 2, `answered` 1, `handoff` 1, `item_hits.ky-so` 1.
- `usage`: `ai_calls` 2, `ai_errors` 0, token vào 2.622, token ra 39.
- `kb_items/ky-so`: `hit_count` 1.

### 3.2 Đo chất lượng (`eval-run`)

Chạy với Haiku, ngưỡng 0,7, 4 mục `approved`, 5 câu thử:

| Kết luận | Số câu |
|---|---|
| đúng | 3 |
| sai mục | 1 ("hướng dẫn cấu hình ký số" → `ky-so`, mong đợi `cau-hinh-chu-ky`) |
| chuyển ca thừa | 1 ("video hướng dẫn cài đặt chữ ký số", độ tin cậy 0,60) |
| trả lời sai khi kho không có | 0 |
| lỗi AI | 0 |

**Nguyên nhân:** AI chỉ thấy `tieu_de` và `cach_hoi`, nên phân biệt `ky-so` với `cau-hinh-chu-ky` không rõ. Cần sửa ở **kho** (viết hai mục cho rõ ranh giới), không sửa mã và không hạ ngưỡng.

**So với spec:**
- Spec yêu cầu 30 câu thử và có bảng so với Sonnet. Hiện mới có 5 câu và chưa chạy Sonnet.
- Spec yêu cầu ít nhất 30 mục `approved` trước khi bật AI. Hiện có 4 mục.

Cả hai điểm đều do bạn quyết định chạy sớm với kho nhỏ.

### 3.3 Chi phí AI đo được

| Nguồn | Số đo | Quy ra |
|---|---|---|
| `eval-run`, 5 câu, 4 mục | 6.598 token vào, 144 token ra | khoảng $0,15 / 1.000 câu |
| Chạy thật, 2 câu | 2.622 token vào, 39 token ra | dưới $0,0003; khoảng $0,4/tháng ở 3.000 câu |

Chi phí tăng theo số mục, vì mỗi lần hỏi đều gửi kèm danh sách mục. Ước tính với 30–50 mục vẫn dưới $1 cho 1.000 câu.

**Giới hạn chi tiêu:**
- Hạn mức chi tiêu ở Anthropic Console: $5/tháng.
- `monthly_ai_call_limit`: 6.000 lượt/tháng.

### 3.4 Điểm khác hoặc bổ sung so với spec

- Model: `claude-haiku-5-5` (bạn chọn giữ Haiku, không dùng AI miễn phí).
- `messages_sent` đếm cả lần gửi lỗi, theo quyết định 3.
- Lỗi AI được ghi là `timeout`, `api_<mã>:<loại>`, `stop_<lý do>`.

## 4. Bước D: trang quản trị

### 4.1 Tiêu chí

| # | Tiêu chí | Kết quả |
|---|---|---|
| D1 | Người ngoài `admins` không đọc, không ghi được | **Đạt.** Đạt trong kiểm thử quy tắc trên emulator. Trên trang thật, tài khoản chưa cấp quyền bị chặn với thông báo "chưa có quyền" |
| D2 | Màn "Câu chưa trả lời" hiện đúng câu bot chuyển ca | Đạt trên emulator; chờ thử thật (đã có câu "nộp thuế" trong `unanswered`) |
| D3 | Soạn đáp án, hỏi lại sau khoảng 1 phút thì bot trả lời đúng | Chờ thử thật |
| D4 | "Gắn vào mục có sẵn" thêm đúng câu hỏi | Đạt trên emulator; chờ thử thật |
| D5 | Thêm, sửa, ẩn mục | Đạt trên emulator; chờ thử thật |
| D6 | Thống kê khớp `conversations` và ứng dụng quản lý bot | Chờ đối chiếu thật |
| D7 | Không ghi được trường cấu hình ngoài danh sách | **Đạt** (kiểm thử quy tắc: `ai_model`, các hạn mức, `bot_mention_name`, `log_raw_body` đều bị từ chối) |
| D8 | Dùng được trên điện thoại | Đạt trên emulator: ở 375 px không tràn ngang, hộp thoại mở toàn màn hình |

**Kiểm thử:** 33 kiểm thử logic và 58 kiểm thử quy tắc đều đạt. Kiểm thử còn xác nhận quy tắc đếm ký tự có dấu đúng: câu trả lời 1.500 ký tự có dấu được nhận, 1.501 ký tự bị từ chối.

### 4.2 Điểm khác hoặc bổ sung so với spec (đã hỏi và bạn đã chốt)

- **Thống kê không tách theo nhóm.** `stats_daily` không có chiều nhóm, và bước D không sửa webhook. Bạn chọn tạm bỏ phần này.
- **Thêm trường:**
  - `config/main.chat_labels`: tên dễ nhớ cho mã nhóm.
  - `updated_by` trên `kb_items` và `config/main`.
  - `handled_by` trên `unanswered`.

  Bot bỏ qua các trường này nên không phải sửa webhook.
- **Nơi đặt mã nguồn:** bản gốc của trang nằm trong `admin/` của dự án này. Kho `zalo-bot-admin` chỉ chứa bản chép `index.html`, nên sửa trang xong phải tải lại tệp lên GitHub.
- **Chế độ emulator:** trang có thêm nút "Đăng nhập tài khoản giả". Nút này chỉ hiện ở `localhost` khi có `?emulator`, để xem trước bằng dữ liệu giả.
- **Web app Firebase** "Quan tri Bot TTHC" được tạo bằng CLI (bạn đồng ý). Cấu hình của Web app công khai theo thiết kế.

## 5. Việc còn lại

### Ngay
1. Tạo `admins/{UID}` cho tài khoản của bạn, rồi thử D2–D6 trên trang thật. Bắt đầu với câu "nộp thuế": soạn đáp án hoặc bỏ qua.
2. Commit thay đổi cấu hình Web app trong `admin/index.html` và các tài liệu vừa cập nhật.

### Kho tri thức
3. Viết lại `tieu_de` và `cach_hoi` của `ky-so` và `cau-hinh-chu-ky` cho rõ ranh giới. Thêm câu thử mới (không chép nguyên vào `cach_hoi`), rồi chạy lại `eval-run`.
4. Mở rộng kho theo những câu xuất hiện nhiều trong `unanswered`. Tăng bộ thử lên khoảng 30 câu, chạy `--model=sonnet` để so sánh. Đó là phần còn thiếu của C7.

### Thử thật trong nhóm
5. **C6:** hỏi lại một câu đã chuyển ca, gõ không dấu.
6. **C5:** thử câu gài lệnh.
7. **C4, C9:** tạm đặt `ai_timeout_ms` = 1000, hoặc `monthly_ai_call_limit` = 0. Thử xong đặt lại, hoặc xóa trường để bot dùng mặc định.
8. **C11:** theo dõi vài ngày xem Zalo có gửi lại yêu cầu trong lúc bot chờ AI không.

### An toàn và vận hành (còn từ giai đoạn 1)
9. Đặt `log_raw_body` = `false` khi không cần soi cấu trúc sự kiện nữa.
10. Vô hiệu hóa `ZALO_WEBHOOK_SECRET` phiên bản 1 (đang dùng phiên bản 2).
11. Chuyển "Webhook secret.txt" và `key.txt` vào trình quản lý mật khẩu rồi xóa khỏi thư mục dự án, vì thư mục này đang đồng bộ OneDrive.
12. Khóa Anthropic `key_zalo_bot` có hạn dùng. Nếu để mặc định 30 ngày, khóa hết hạn khoảng ngày 16/12/2026. Cần tạo khóa mới, chạy `firebase functions:secrets:set ANTHROPIC_API_KEY`, rồi `firebase deploy --only functions` trước ngày đó.
13. Mỗi tuần: xem câu chưa trả lời, bổ sung kho, xem tin đã gửi so với 3.000 trên màn Thống kê.
