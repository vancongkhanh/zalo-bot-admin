# Bot Zalo hỗ trợ khách hàng tích hợp AI: tổng kết và kế hoạch thực hiện

Cập nhật: 16/11/2026 (tối: thêm mục "Tiến độ" ngay dưới). Tài liệu này tổng hợp các quyết định, kết quả thử nghiệm giai đoạn 0 và kế hoạch làm từng bước. Bản đề xuất đầy đủ (kèm nguồn) nằm trong tài liệu "Đề xuất: Bot Zalo hỗ trợ khách hàng tích hợp AI". Mục nào ghi "Đề xuất" là chưa được bạn chốt; mục ghi "Chưa xác minh" cần thử trước khi tin cậy.

## 1. Mục tiêu

Bot Zalo trả lời câu hỏi hướng dẫn sử dụng (HDSD) trong nhóm Zalo của người dùng khối chính quyền, dựa trên PDF, ảnh và video HDSD đã có. AI chỉ trả lời từ nội dung đã duyệt trong kho tri thức. Câu hỏi bot chưa trả lời được sẽ hiện trên trang quản trị để bạn soạn đáp án, duyệt và đưa vào kho. Giai đoạn đầu chỉ mình bạn dùng và nhận ca chuyển giao.

## Tiến độ (16/11/2026)

Thứ tự làm đã đổi theo [spec/spec-buoc-A-B-C-D.md](spec/spec-buoc-A-B-C-D.md): bỏ qua nhập PDF/ảnh (giai đoạn 2 cũ, để sau), làm trước vòng khép kín bằng kho chữ. Chi tiết: [báo cáo/bao-cao-buoc-B-C-D.md](báo%20cáo/bao-cao-buoc-B-C-D.md).

| Phần | Tương ứng kế hoạch dưới | Trạng thái |
|---|---|---|
| Giai đoạn 1: webhook | Giai đoạn 1 | Xong, qua cổng duyệt |
| A: soạn kho chữ và bộ thử | Giai đoạn 2 (phần chữ) | Đang làm: 4 mục `approved`, 5 câu thử (mục tiêu 30-50 mục, 30 câu) |
| B: script nạp/xuất/duyệt Excel | Giai đoạn 2 | Xong |
| C: AI chọn mục, trả lời nguyên văn | Giai đoạn 3 | Đã triển khai và bật; trả lời và chuyển ca đúng trên Zalo thật. Còn thiếu bộ thử đủ 30 câu và so Sonnet |
| D: trang quản trị | Giai đoạn 4 | Đã lên GitHub Pages, quy tắc đã triển khai; chờ tạo `admins/{uid}` để thử vòng khép kín |
| Nhập PDF, ảnh, `sendPhoto` | Giai đoạn 2 (bước 2.3, 2.4), 3.5 | Chưa làm (`steps`, `image_urls` đã chừa chỗ trong `kb_items`) |
| Chạy thử và vận hành | Giai đoạn 5 | Bắt đầu khi vòng khép kín chạy được |

Thay đổi so với kế hoạch dưới: **AI không soạn câu trả lời**, chỉ chọn mục (`{slug, confidence}`), bot gửi nguyên văn nội dung đã duyệt (bảng quyết định trong spec A-D, mục 1). Model đã chốt: Haiku 5.5. Trang quản trị: HTML đơn trên GitHub Pages (`vancongkhanh.github.io/zalo-bot-admin`). Cấu trúc dữ liệu thực tế xem [README.md](README.md); bảng "Dữ liệu trong Firestore" ở mục 5 là bản đề xuất ban đầu.

## 2. Các quyết định đã chốt

| Hạng mục | Quyết định |
|---|---|
| Nơi bot hoạt động | Nhóm Zalo (người dùng phải @bot mỗi lần hỏi) |
| Kho tri thức | PDF và video HDSD hiện có, đang lưu ở Google Drive; tài liệu không bí mật |
| AI | Tích hợp ngay; chỉ trả lời từ mục đã duyệt |
| Ảnh | Gửi công khai bằng đường dẫn (URL); gửi ảnh trực tiếp đang **tạm hoãn** (xem mục 4) |
| Video | Chỉ gửi link (kể cả link Facebook) |
| Trang quản trị | Xem câu hỏi chưa có đáp án, soạn và duyệt, đưa vào kho; đăng nhập Firebase Auth |
| Hạ tầng | Firebase (đã dùng gói Blaze, trong hạn mức miễn phí) |
| Dữ liệu hội thoại đi qua dịch vụ ngoài | Không phải mối lo |
| Người nhận ca chuyển | Giai đoạn đầu chỉ bạn; thiết kế sẵn danh sách quản trị để thêm đội nhóm |
| Cách làm việc | Duyệt đề xuất trước, spec cho Claude Code theo từng giai đoạn, làm chậm và từng bước |

**Đề xuất, chưa chốt:** Cloud Functions viết bằng Node.js; trang quản trị là một file HTML đặt trên GitHub Pages; ảnh lưu trên Firebase Storage hoặc GitHub Pages; vùng triển khai `asia-southeast1`.

## 3. Thông tin nền tảng Zalo Bot đã xác nhận

Nguồn: tài liệu chính thức Zalo Bot (bản Beta) và trang Giá gói, ảnh chụp 14/11/2026, cộng với thử nghiệm thực tế.

### 3.1 API

| Nội dung | Chi tiết |
|---|---|
| Địa chỉ | `POST https://bot-api.zaloplatforms.com/bot{TOKEN}/{phương thức}`, trả JSON |
| Nhận tin | Hai cách loại trừ nhau: `getUpdates` (long polling, chỉ nên dùng khi thử nghiệm) hoặc Webhook. Đã đặt webhook thì phải gọi `deleteWebhook` trước khi dùng `getUpdates` |
| `getUpdates` | Tham số `timeout` (giây, mặc định 30). Hết thời gian chờ không có tin thì trả lỗi `408 Request timeout` (bình thường) |
| `setWebhook` | `url` (HTTPS, công khai) và `secret_token` (8-256 ký tự), bắt buộc. Zalo gửi token trong header `X-Bot-Api-Secret-Token` ở mọi yêu cầu. `localhost` và IP nội bộ bị từ chối |
| `sendMessage` | `chat_id`, `text` (1-2000 ký tự) bắt buộc; tùy chọn `parse_mode` (`markdown` hoặc `html`) và `text_styles` |
| `sendPhoto` | `chat_id`, `photo` (đường dẫn ảnh) bắt buộc; `caption` (1-2000 ký tự) tùy chọn. Chưa thử thành công (mục 4) |
| Phương thức khác thấy trong bộ đếm | `sendSticker`, `sendChatAction` |

### 3.2 Gói Basic (miễn phí)

Tối đa 3 bot; mỗi bot tối đa 50 người dùng; gửi tối đa 3.000 tin/tháng; tương tác với 3 nhóm (Beta). Gói Pro "sắp ra mắt", giá chưa công bố chính thức.

### 3.3 Cấu trúc sự kiện đã thấy khi thử

| Trường | Chat riêng | Nhóm |
|---|---|---|
| `event_name` | `message.text.received` | `message.text.received` (chữ), `message.image.received` (ảnh) |
| `message.chat.chat_type` | `PRIVATE` | `GROUP` |
| `message.chat.id` | Bằng `from.id` | Dạng `zgr-...` (mã nhóm) |
| `message.from` | `id`, `display_name`, `is_bot` | Giống chat riêng |
| `message.text` | Chỉ nội dung | Bắt đầu bằng phần @tên bot (ví dụ `@Bot TTHC Đảng hello`) |
| `message.message_id`, `date` (mili giây), `message_type` | Có (`CHAT_TEXT`) | Có (`CHAT_TEXT`, `CHAT_PHOTO`) |
| Ảnh | | `photo_url` (địa chỉ ảnh trên máy chủ Zalo), `caption` (chữ kèm ảnh, chứa cả phần @) |

Kết quả `getUpdates` có cùng cấu trúc với nội dung webhook, nên một đoạn mã xử lý dùng được cho cả hai.

## 4. Kết quả thử nghiệm giai đoạn 0 (14/11/2026)

| Điều đã thử | Kết quả |
|---|---|
| Nhận tin chat riêng | Đạt |
| Nhận tin trong nhóm khi @bot | Đạt |
| Nhắn thường không @ trong nhóm | Không có sự kiện, nên người dùng phải @bot |
| Người dùng gửi ảnh kèm @bot | Nhận được sự kiện ảnh, có `photo_url`; mở được trong trình duyệt của bạn |
| Bot gửi chữ vào nhóm | Đạt (`ok: true`, tin hiển thị trong nhóm) |
| Bot gửi ảnh (`sendPhoto`) | **Chưa kết luận.** Các lần thử đều lỗi "The photo must not be empty", nhưng đã nhiều lần dùng lệnh gõ thẳng trong CMD nên JSON có thể bị hỏng. Tạm hoãn theo quyết định của bạn |

**Việc còn mở từ giai đoạn 0 (không chặn giai đoạn 1):**

| Điều chưa rõ | Cách xác minh |
|---|---|
| `sendPhoto` có chạy với ảnh công khai không | Thử lại bằng Node.js (đoạn mã ở mục 11) thay vì CMD |
| Ảnh và tin nhận có tính vào hạn mức 3.000 tin không | Xem bộ đếm trong ứng dụng quản lý bot (zalo.me/s/botcreator) sau khi gửi thử ảnh |
| `photo_url` tải được khi không đăng nhập không; tồn tại bao lâu | `curl.exe -I "<photo_url>"`; mở lại sau vài giờ. Cần nếu làm tính năng phân tích ảnh |
| Reply vào tin bot (không @) có tạo sự kiện không | Reply rồi chạy `getUpdates` |
| `parse_mode`, `text_styles`, xem trước link Facebook/Drive/YouTube | Gửi thử |
| Giới hạn tốc độ và thời gian phản hồi tối đa của webhook | Đo ở giai đoạn 1; hỏi Zalo |

**Phương án dự phòng nếu `sendPhoto` không dùng được:** bot gửi một tin chữ kèm link ảnh hoặc link bài hướng dẫn. Khi `sendPhoto` chạy được thì bật gửi ảnh trực tiếp, không phải làm lại phần còn lại.

## 5. Kiến trúc

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| Zalo Bot | Zalo Bot Platform | Nhận tin trong nhóm, gọi webhook |
| Webhook | Firebase Cloud Functions | Kiểm tra header bí mật, chống trùng, điều phối, gọi Zalo và AI |
| Kho tri thức và dữ liệu | Firestore | Mục HDSD, câu hỏi chưa trả lời, nhật ký, bộ đếm |
| Model AI | Claude API (`claude-haiku-5-5` hoặc `claude-sonnet-5-5`, chốt sau khi thử) | Soạn câu trả lời chỉ từ mục đã duyệt |
| Lưu ảnh | Firebase Storage hoặc GitHub Pages (đề xuất) | Địa chỉ công khai cho ảnh |
| Trang quản trị | HTML đơn trên GitHub Pages + Firebase Auth (đề xuất) | Câu hỏi chưa trả lời, soạn và duyệt, thống kê |

GitHub Pages chỉ chứa trang tĩnh nên không chạy được webhook; phần nhận tin bắt buộc cần backend (Cloud Functions).

**Luồng xử lý một câu hỏi:**

1. Người dùng @bot trong nhóm.
2. Zalo gọi webhook kèm header `X-Bot-Api-Secret-Token`. Function từ chối nếu sai token; bỏ qua nếu `message_id` đã xử lý.
3. Chỉ xử lý nếu `chat.id` nằm trong danh sách nhóm cho phép.
4. Cắt phần @tên bot ở đầu `text` (hoặc `caption`).
5. Tìm mục HDSD đã duyệt liên quan (giai đoạn 3).
6. Có căn cứ: AI soạn câu trả lời từ mục đó; bot gửi một tin chữ, kèm link ảnh/video (và ảnh trực tiếp khi `sendPhoto` dùng được).
7. Không đủ căn cứ: bot gửi tin mẫu "đã ghi nhận, sẽ có người hỗ trợ" và ghi câu hỏi vào danh sách chưa trả lời.
8. Ghi nhật ký, tăng bộ đếm tin gửi và chi phí AI.
9. Bạn mở trang quản trị, soạn đáp án và duyệt; mục mới vào kho, lần sau bot tự trả lời.

### Dữ liệu trong Firestore

| Bộ sưu tập | Nội dung chính |
|---|---|
| `kb_items` | `title`, `keywords[]`, `steps[]` (nội dung từng bước), `images[]` (URL), `video_links[]`, `source` (PDF, trang), `status` (`draft` hoặc `approved`), `approved_at` |
| `unanswered` | `question`, `count`, `cluster_key`, `last_asked_at`, `status` (`new` hoặc `answered`) |
| `conversations` | `event_id` (= `message_id`), `chat_id`, `from_id`, `question`, `used_items[]`, `answer`, `outcome` (`answered` hoặc `handoff`), `created_at` |
| `usage` | Tài liệu theo tháng (ví dụ `2026-11`): `messages_sent`, `ai_input_tokens`, `ai_output_tokens` |
| `admins` | Mã người dùng Firebase (UID) của người quản trị; giai đoạn đầu chỉ có bạn |
| `config` | `allowed_chat_ids[]`, `bot_mention_name`, `ai_model`, `confidence_threshold`, `monthly_message_limit` (3000) |

## 6. Cấu hình và bí mật

| Tên | Nơi lưu | Ghi chú |
|---|---|---|
| `ZALO_BOT_TOKEN` | Secret của Cloud Functions (`defineSecret`) | **Đặt lại token trước khi chạy thật**, vì token cũ đã lộ trong ảnh chụp. Không đưa vào mã nguồn, không gửi vào chat |
| `ZALO_WEBHOOK_SECRET` | Secret của Cloud Functions | Chuỗi 8-256 ký tự tự đặt, dùng cho `setWebhook` |
| `ANTHROPIC_API_KEY` | Secret của Cloud Functions | Dùng từ giai đoạn 3 |
| Cấu hình Firebase của trang quản trị | Trong file HTML | Là thông tin công khai; an toàn dựa vào Firebase Auth và quy tắc Firestore |

Ghi chú khi thử trên Windows: không gõ JSON thẳng trong CMD. Dùng tệp (`-d @file.json`) hoặc viết một đoạn Node.js/Python nhỏ; dùng biến `set TOKEN=...` và `%TOKEN%` để token không hiện trong ảnh chụp.

## 7. Kế hoạch thực hiện chi tiết

Thời gian là ước tính, chưa có căn cứ, sẽ chốt lại sau giai đoạn 1. Mỗi giai đoạn có tiêu chí hoàn thành và cổng duyệt: chưa đạt thì chưa sang giai đoạn sau. "Ai": Bạn, Claude (soạn spec, hướng dẫn), Claude Code (viết mã theo spec đã duyệt).

### Giai đoạn 0. Xác minh nền tảng: đã hoàn thành phần chính

Còn lại: đặt lại token (bước 1.2), thử lại `sendPhoto` bằng Node.js khi bạn muốn. Cổng duyệt 0: đã đạt cho phần chữ.

### Giai đoạn 1. Webhook cơ bản (ước tính 3-5 ngày)

| Bước | Việc | Ai | Tiêu chí hoàn thành |
|---|---|---|---|
| 1.1 | Soạn spec giai đoạn 1 từ tài liệu này | Claude, rồi bạn duyệt | Spec được duyệt |
| 1.2 | Đặt lại token bot (hoặc tạo bot mới); kiểm tra dự án Firebase và gói Blaze; đặt cảnh báo ngân sách; tạo secret `ZALO_BOT_TOKEN` và `ZALO_WEBHOOK_SECRET` | Bạn | Có secret, có cảnh báo ngân sách |
| 1.3 | Khởi tạo dự án Firebase Functions (Node.js), vùng `asia-southeast1`; cấu trúc thư mục, cấu hình, lớp bọc gọi API Zalo (`sendMessage`, `deleteWebhook`, `setWebhook`) | Claude Code | Triển khai thử một hàm rỗng thành công |
| 1.4 | Hàm webhook: kiểm tra header `X-Bot-Api-Secret-Token`, chống trùng theo `message_id`, chỉ xử lý nhóm trong `allowed_chat_ids` và có @bot, cắt phần @tên bot | Claude Code | Sai header bị từ chối; sự kiện trùng chỉ xử lý một lần; tin không phải @bot bị bỏ qua |
| 1.5 | Gọi `deleteWebhook` (nếu cần) rồi `setWebhook` với địa chỉ hàm | Bạn, Claude Code | Webhook đăng ký thành công |
| 1.6 | Bot trả lời cố định "Đã nhận: (câu hỏi)" vào đúng nhóm | Claude Code, bạn thử | Hỏi trong nhóm thử, bot trả lời đúng nhóm |
| 1.7 | Ghi nhật ký vào `conversations`, tăng `usage.messages_sent` | Claude Code | Số liệu khớp với bộ đếm trong ứng dụng quản lý bot |
| 1.8 | Đo thời gian phản hồi và thử tin lặp (retry) | Bạn, Claude Code | Biết webhook có cần trả lời 200 sớm hơn không |

Cổng duyệt 1: bot nhận và trả lời ổn định trong nhóm thử ít nhất vài ngày.

### Giai đoạn 2. Kho tri thức (ước tính 5-7 ngày)

| Bước | Việc | Ai | Tiêu chí hoàn thành |
|---|---|---|---|
| 2.1 | Kiểm kê tài liệu HDSD (PDF, video, chủ đề); chọn 10-20 chủ đề hay hỏi nhất để làm trước | Bạn | Danh sách chủ đề ưu tiên |
| 2.2 | Chốt cấu trúc `kb_items` và quy trình nhập; soạn spec | Claude, rồi bạn duyệt | Spec được duyệt |
| 2.3 | Công cụ nhập PDF: tách chữ và ảnh các bước, tạo mục ở trạng thái `draft` | Claude Code | Một PDF mẫu nhập đúng chữ và ảnh |
| 2.4 | Lưu ảnh lên Firebase Storage hoặc GitHub Pages, lấy URL công khai | Claude Code | Ảnh mở được bằng URL trực tiếp |
| 2.5 | Rà soát và duyệt từng mục (`draft` sang `approved`) | Bạn | Ít nhất 10 mục đã duyệt, ảnh đúng bước |
| 2.6 | Gắn link video (YouTube, Facebook, Drive) vào mục tương ứng | Bạn | Mỗi mục có video có link hợp lệ |

Cổng duyệt 2: kho có đủ mục cho các chủ đề ưu tiên và bạn xác nhận nội dung đúng.

### Giai đoạn 3. AI trả lời (ước tính 5-7 ngày)

| Bước | Việc | Ai | Tiêu chí hoàn thành |
|---|---|---|---|
| 3.1 | Soạn spec: cách chọn mục, chỉ dẫn cho AI, ngưỡng "đủ chắc chắn", mẫu tin trả lời | Claude, rồi bạn duyệt | Spec được duyệt |
| 3.2 | Chọn mục liên quan. Đề xuất bắt đầu đơn giản: kho còn nhỏ nên đưa danh sách tiêu đề và tóm tắt các mục đã duyệt vào chỉ dẫn, để AI chọn mã mục. Chỉ chuyển sang từ khóa hoặc embedding khi kho lớn | Claude Code | Với bộ câu hỏi mẫu, chọn đúng mục |
| 3.3 | Gọi Claude API, yêu cầu trả về JSON: `answer`, `item_ids`, `confidence`, `needs_human`. Thử Haiku trước, so với Sonnet trên 20-30 câu hỏi thật | Claude Code, bạn | Bảng so sánh chất lượng và chi phí, chọn model |
| 3.4 | Quy tắc: chỉ trả lời từ mục đã duyệt; `needs_human` hoặc dưới ngưỡng thì gửi tin mẫu và ghi vào `unanswered` | Claude Code | Câu hỏi ngoài kho không bị trả lời bịa |
| 3.5 | Gửi một tin chữ kèm link ảnh/video; nếu `sendPhoto` dùng được thì gửi thêm tối đa vài ảnh; kiểm soát số tin theo hạn mức | Claude Code | Số tin mỗi câu trả lời nằm trong mức đã đặt |
| 3.6 | Thử bộ 30 câu hỏi thật, đánh giá đúng, sai, chuyển ca | Bạn | Không có câu trả lời sai nghiêm trọng (ngưỡng do bạn đặt) |
| 3.7 (tùy chọn) | Phân tích ảnh người dùng gửi: tải `photo_url` ngay khi nhận sự kiện, gửi cho Claude cùng `caption` (đã cắt @), đối chiếu kho. Chỉ làm nếu `photo_url` tải được không cần đăng nhập | Claude Code | Đọc đúng nội dung ảnh chụp màn hình lỗi trong bộ thử |

Cổng duyệt 3: bạn đồng ý chất lượng trả lời và chi phí AI thực tế.

### Giai đoạn 4. Trang quản trị (ước tính 5-7 ngày)

| Bước | Việc | Ai | Tiêu chí hoàn thành |
|---|---|---|---|
| 4.1 | Soạn spec các màn hình và quyền truy cập | Claude, rồi bạn duyệt | Spec được duyệt |
| 4.2 | Đăng nhập Firebase Auth; quy tắc Firestore chỉ cho UID trong `admins` đọc và ghi `kb_items`, `unanswered`, `conversations`, `usage`, `config` | Claude Code | Người ngoài danh sách không đọc, không ghi được |
| 4.3 | Màn "Câu hỏi chưa trả lời": nhóm câu giống nhau, số lần hỏi, lần hỏi gần nhất | Claude Code | Thấy đúng các câu bot chuyển ca |
| 4.4 | Soạn đáp án kèm ảnh và link video, duyệt, đưa vào `kb_items` | Claude Code | Câu hỏi đó hỏi lại, bot trả lời đúng |
| 4.5 | Màn thống kê: câu hỏi mỗi ngày, tỷ lệ bot tự trả lời, chủ đề hay hỏi, tin gửi trong tháng so với 3.000 | Claude Code | Số liệu khớp với nhật ký |
| 4.6 | Màn quản lý các mục kho tri thức, tải PDF mới | Claude Code | Thêm, sửa, ẩn một mục được |

Cổng duyệt 4: vòng khép kín hoạt động, từ câu hỏi mới chưa có đáp án đến bot tự trả lời sau khi bạn duyệt.

### Giai đoạn 5. Chạy thử và vận hành (2-4 tuần, theo dõi liên tục)

| Bước | Việc | Ai |
|---|---|---|
| 5.1 | Dùng thật trong một nhóm nhỏ; ghim hướng dẫn "@Bot + câu hỏi" trong nhóm | Bạn |
| 5.2 | Mỗi tuần: xem câu chưa trả lời, bổ sung kho, kiểm tra bộ đếm hạn mức | Bạn |
| 5.3 | Đo tỷ lệ bot tự trả lời, số tin mỗi tháng, chi phí AI thực tế | Bạn, Claude hỗ trợ báo cáo |
| 5.4 | Quyết định mở rộng: thêm nhóm, thêm đồng nghiệp, hay nâng gói | Bạn |

### Giai đoạn 6. Mở rộng (khi cần)

Thêm tài khoản quản trị cho đội nhóm (thêm UID vào `admins`); theo dõi gói Pro hoặc Zalo OA khi vượt hạn mức hoặc cần hơn 3 nhóm hay 50 người/bot; đồng bộ tự động tài liệu từ Google Drive nếu cần.

## 8. Chi phí và hạn mức

| Hạng mục | Ước tính | Căn cứ |
|---|---|---|
| Zalo Bot gói Basic | 0đ; 3.000 tin gửi/tháng | Trang Giá gói của Zalo |
| Claude Haiku 5.5 | khoảng 3,6 USD/tháng ở 200 request/ngày | Giá 0,10 USD vào và 0,50 USD ra mỗi triệu token; giả định 4.000 token vào, 400 ra mỗi request (phép tính của Claude, nguồn giá bên thứ ba) |
| Claude Sonnet 5.5 | khoảng 72 USD/tháng, cùng giả định | Giá 2 USD vào và 10 USD ra mỗi triệu token |
| Firebase | Trong hạn mức miễn phí ở quy mô này; đặt cảnh báo ngân sách | Nguồn bên thứ ba, nên đối chiếu trang giá Firebase |

| Kịch bản | Tin gửi/tháng | So với 3.000 |
|---|---|---|
| Giai đoạn đầu, khoảng 30 request/ngày, mỗi câu trả lời 1 tin chữ + 1 ảnh | khoảng 1.800 | Trong hạn mức |
| 200 request/ngày, mỗi câu trả lời 1 tin chữ | khoảng 6.000 | Gấp đôi |
| 200 request/ngày, mỗi câu trả lời 1 chữ + 2 ảnh | khoảng 18.000 | Gấp sáu |

Biện pháp: bộ đếm tin gửi trong `usage` với cảnh báo khi đạt 80%; gộp nội dung thành ít tin; giới hạn số ảnh mỗi câu trả lời; theo dõi gói Pro hoặc Zalo OA.

## 9. Rủi ro

| Rủi ro | Biện pháp |
|---|---|
| Vượt hạn mức 3.000 tin/tháng | Bộ đếm và cảnh báo; gộp tin; giới hạn ảnh |
| Chỉ 3 nhóm và 50 người/bot ở Basic | Chọn nhóm ưu tiên; theo dõi gói Pro |
| Token bot đã lộ trong ảnh chụp | Đặt lại token trước khi chạy thật; chỉ lưu trong secret |
| AI trả lời sai hoặc bịa | Chỉ dùng mục đã duyệt; ngưỡng chắc chắn; không có căn cứ thì chuyển ca; tin chào nêu rõ là trợ lý tự động |
| Nền tảng đang Beta, API và giới hạn có thể đổi | Bọc lời gọi Zalo trong một lớp riêng; theo dõi ngày cập nhật tài liệu |
| `sendPhoto` chưa xác nhận | Phương án dự phòng gửi link ảnh trong tin chữ |
| Phát sinh phí Firebase | Cảnh báo ngân sách; giới hạn số lần gọi AI mỗi ngày |
| Zalo gọi lại webhook nhiều lần khi phản hồi chậm | Chống trùng theo `message_id`; đo thời gian phản hồi ở bước 1.8 |

## 10. Cách làm việc với Claude Code

1. Bạn duyệt tài liệu này.
2. Với mỗi giai đoạn, Claude soạn một spec hoàn chỉnh để bạn duyệt trước.
3. Bạn giao spec đã duyệt cho Claude Code, làm từng giai đoạn, không gộp nhiều giai đoạn.
4. Kiểm tra theo tiêu chí hoàn thành, qua cổng duyệt rồi mới sang giai đoạn sau.

Việc cần làm ngay để bắt đầu giai đoạn 1: đặt lại token (bước 1.2), xác nhận dự án Firebase dùng (có sẵn hay tạo mới), xác nhận Node.js hay Python, và tên bot đúng như hiển thị trong nhóm (để cắt phần @).

## 11. Đoạn mã thử `sendPhoto` bằng Node.js

Cần Node 18 trở lên. Lưu thành `gui_anh.js`, chạy `set TOKEN=<token>` rồi `node gui_anh.js`. Không dán token vào chat.

```js
const token = process.env.TOKEN;
fetch(`https://bot-api.zaloplatforms.com/bot${token}/sendPhoto`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    chat_id: "ID_NHOM_DANG_zgr-...",
    photo: "https://placehold.co/600x400.png",
    caption: "Buoc 1",
  }),
}).then((r) => r.text()).then(console.log);
```

Kết quả `"ok":true` và ảnh hiện trong nhóm thì `sendPhoto` dùng được; sau đó đổi `photo` sang ảnh `.jpg` hoặc `.png` của bạn trên GitHub Pages hoặc Firebase Storage. Lỗi khác "must not be empty" nghĩa là dữ liệu đã tới máy chủ, vấn đề nằm ở địa chỉ ảnh.

## 12. Câu hỏi còn mở

| # | Câu hỏi | Trạng thái |
|---|---|---|
| 1 | Dự án Firebase: dùng dự án có sẵn hay tạo mới? | Đã chốt: `zalo-bot-tthc-dang` |
| 2 | Node.js hay Python cho Cloud Functions? | Đã chốt: Node.js 24, TypeScript |
| 3 | Tên bot hiển thị trong nhóm để cắt phần @ | Đã chốt: "Bot TTHC Đảng" |
| 4 | Lưu ảnh ở Firebase Storage hay GitHub Pages? | Còn mở, khi làm nhập PDF/ảnh |
| 5 | Haiku hay Sonnet? | Đã chốt: Haiku 5.5. Nên so lại với Sonnet khi bộ thử đủ 30 câu |
| 6 | Ngưỡng "đủ chắc chắn" và danh sách chủ đề ưu tiên | Ngưỡng tạm 0,7; chỉnh sau khi có bộ thử đủ. Chủ đề ưu tiên: lấy từ `unanswered` |
| 7 | Địa chỉ (tên miền) cho trang quản trị | Đã chốt: `vancongkhanh.github.io/zalo-bot-admin` |
