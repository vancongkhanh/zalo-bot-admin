# Bot TTHC Đảng

Bot Zalo trả lời câu hỏi hướng dẫn sử dụng trong nhóm Zalo. Người dùng nhắn `@Bot TTHC Đảng <câu hỏi>`. AI (Claude Haiku 5.5) **chỉ chọn** mục phù hợp trong kho tri thức đã duyệt, rồi bot gửi **nguyên văn** nội dung mục đó. Câu không trả lời được thì bot gửi tin chuyển ca, và câu đó hiện trên trang quản trị để bạn bổ sung đáp án.

- Dự án Firebase: `zalo-bot-tthc-dang` (Cloud Functions thế hệ 2, Node.js 24, vùng `asia-southeast1`)
- Webhook: `https://asia-southeast1-zalo-bot-tthc-dang.cloudfunctions.net/zaloWebhook`
- Trang quản trị: `https://vancongkhanh.github.io/zalo-bot-admin/` (kho GitHub riêng `zalo-bot-admin`)
- Báo cáo chi tiết từng bước: [báo cáo/](báo%20cáo/), spec: [spec/](spec/), kế hoạch tổng: [zalo-bot-ke-hoach-thuc-hien.md](zalo-bot-ke-hoach-thuc-hien.md)

## Trạng thái (16/11/2026)

| Bước | Nội dung | Trạng thái |
|---|---|---|
| Giai đoạn 1 | Webhook: xác thực, chống trùng, nhóm được phép, nhật ký, bộ đếm | Đã triển khai, qua cổng duyệt |
| B | Script nạp/xuất/duyệt kho từ Excel (`scripts/kb`) | Xong, đạt B1-B6 |
| C | AI chọn mục, trả lời nguyên văn, chuyển ca, `unanswered`, thống kê | Đã triển khai 16/11 16:21, `ai_enabled` đang bật; C2, C3, C8 đạt khi chạy thật |
| D | Trang quản trị + quy tắc Firestore | Quy tắc đã triển khai; trang đã lên GitHub Pages; chờ tạo `admins/{uid}` để thử D2-D6 |
| E | Ảnh trong câu trả lời (Firebase Storage, `sendPhoto`) | Đã triển khai 16/11/2026 (Storage `US-CENTRAL1`, quy tắc, hàm); chờ tải trang mới lên GitHub và thử E1-E10 thật. Xem [spec/spec-buoc-E-anh.md](spec/spec-buoc-E-anh.md) |

Xem [báo cáo/bao-cao-buoc-B-C-D.md](báo%20cáo/bao-cao-buoc-B-C-D.md) để biết tiêu chí từng bước, chi phí đo được và việc còn lại.

## Cấu trúc

```
firebase.json, .firebaserc
firestore.rules           quy tắc: chỉ admins/{uid} đọc/ghi qua trang quản trị; mọi thứ khác từ chối
storage.rules             quy tắc Storage (bước E): admins tải ảnh vào kb_images/{slug}/, không ghi đè, không xóa
firestore.indexes.json    chỉ mục unanswered; TTL cho processed_events.expire_at, conversations.expire_at
functions/src/
  index.ts       hàm zaloWebhook (nối secrets, Firestore, logger, Anthropic vào luồng xử lý), suggestQuestions và usdVndRate
  suggest.ts     trang quản trị: AI gợi ý "cách hỏi" cho một mục (chỉ admins gọi được; gợi ý không gửi người dùng Zalo)
  webhook.ts     luồng xử lý chính (giai đoạn 1, bước C, ảnh bước E, đọc ảnh người dùng bước F)
  selector.ts    gọi Claude chọn mục: trả {slug, confidence}, kiểm tra đầu ra; bước F: chọn mục từ ảnh (+ mô tả cho quản trị)
  fxRate.ts      tỷ giá bán USD Vietcombank cho ô chi phí AI (đọc XML công khai, đệm 6 giờ ở fx_rates/usd_vnd; chỉ admins gọi)
  imageFetch.ts  bước F: tải ảnh người dùng từ photo_url (https, ≤ 5 MB, 10 giây, nhận dạng JPEG/PNG/WebP/GIF), không lưu
  kb.ts          mục kho, ghép câu trả lời + link, chọn ảnh gửi/thành link, chuẩn hóa câu hỏi cho unanswered
  zaloClient.ts  sendMessage, sendPhoto, setWebhook, deleteWebhook, getMe, getWebhookInfo
  mention.ts     cắt @tên bot
  security.ts    so sánh secret thời gian không đổi
  store.ts       Firestore: chống trùng, nhật ký, bộ đếm, cấu hình, kho, unanswered, stats_daily
  config.ts      secrets, đọc config/main, ngày/tháng theo giờ Việt Nam
functions/test/  kiểm thử đơn vị (vitest)
scripts/
  webhook-set.mjs, webhook-delete.mjs, check-bot.mjs   đăng ký, xóa, chẩn đoán webhook
  send-sample.mjs, sample-event.json                   gửi sự kiện mẫu (giá trị giả) tới hàm
  test-photo.mjs      thử sendPhoto với một link ảnh
  kb/                 kho tri thức và đo chất lượng (bước B, C), xem scripts/kb/README.md
admin/
  index.html          trang quản trị (bước D), một tệp; bản chạy thật chép sang kho zalo-bot-admin
  test/               kiểm thử logic trang và quy tắc Firestore, Storage (emulator), dữ liệu giả để xem trước
  README.md           cài đặt, quyền, kiểm thử, xem trước
input/                Excel dữ liệu thật (không commit)
```

## Bí mật

Không bao giờ ghi token, secret, khóa hay mã nhóm thật vào mã nguồn, Git hay nhật ký. Không tạo tệp khóa dịch vụ.

| Tên | Lưu ở | Ghi chú |
|---|---|---|
| `ZALO_BOT_TOKEN` | Firebase secret | Token bot |
| `ZALO_WEBHOOK_SECRET` | Firebase secret | 8-256 ký tự, **chỉ `A-Z a-z 0-9 _ -`** (Zalo từ chối ký tự khác). Đang dùng phiên bản 2 |
| `ANTHROPIC_API_KEY` | Firebase secret | Khóa Anthropic (workspace Zalo-bot, hạn mức chi tiêu tháng đặt ở Anthropic Console). **Phải có trước khi triển khai** hàm, kể cả khi `ai_enabled` tắt. Khóa có hạn dùng: đổi trước khi hết hạn |
| Mã nhóm | Firestore `config/main` | Không ghi vào mã |
| Cấu hình Web app Firebase | `admin/index.html` | Công khai theo thiết kế; an toàn dựa vào đăng nhập Google và quy tắc Firestore |

Đặt hoặc đổi secret (gõ giá trị tại dấu nhắc; dán bằng chuột phải trong cmd):

```
firebase functions:secrets:set ZALO_BOT_TOKEN
firebase functions:secrets:set ZALO_WEBHOOK_SECRET
firebase functions:secrets:set ANTHROPIC_API_KEY
```

Tạo secret ngẫu nhiên hợp lệ: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

Sau khi đổi secret phải **triển khai lại** (`firebase deploy --only functions`), vì hàm gắn với một phiên bản secret cụ thể. Đổi `ZALO_WEBHOOK_SECRET` thì chạy lại `webhook-set` với giá trị mới.

## Cấu hình `config/main` (Firestore)

| Trường | Kiểu | Ý nghĩa |
|---|---|---|
| `allowed_chat_ids` | array chuỗi | Mã nhóm được phép (`zgr-...`). Gói Basic cho tối đa 3 nhóm |
| `chat_labels` | map | Tên dễ nhớ cho từng mã nhóm (trang quản trị dùng; bot bỏ qua) |
| `bot_mention_name` | string | `Bot TTHC Đảng` |
| `monthly_message_limit` | number | `3000` |
| `reply_enabled` | boolean | `false` để tạm tắt trả lời, vẫn ghi nhật ký |
| `log_raw_body` | boolean | `true`: ghi thân yêu cầu (đã che nội dung, tên, mã người dùng) ra Cloud Logging. Tắt khi không cần |
| `ai_enabled` | boolean | Mặc định `false`: trả lời như giai đoạn 1 ("Đã nhận: ..."). `true`: trả lời bằng kho qua AI |
| `ai_model` | string | Mặc định `claude-haiku-5-5` |
| `confidence_threshold` | number 0-1 | Mặc định `0.7`. Dưới ngưỡng thì chuyển ca |
| `monthly_ai_call_limit` | number | Mặc định `6000`. Hết hạn mức: không gọi AI, gửi tin chuyển ca |
| `handoff_message` | string | Tin chuyển ca (tối đa 1.000 ký tự) |
| `ai_timeout_ms` | number | Mặc định `15000`, cho phép 1.000-50.000 |
| `max_images_per_answer` | number | Bước E. Mặc định `4`, số nguyên 0-10. Số ảnh gửi kèm một câu trả lời (mỗi ảnh tính 1 tin); ảnh còn lại thành link trong tin chữ; `0` = không gửi ảnh |
| `image_ai_enabled` | boolean | Bước F. Mặc định `false`. `true` (cùng `ai_enabled`): đọc ảnh có gọi tên bot trong chú thích bằng AI để chọn mục |
| `monthly_image_ai_limit` | number | Bước F. Mặc định `300`, số nguyên 0-10.000. Lượt đọc ảnh mỗi tháng; vẫn tính vào `monthly_ai_call_limit` |
| `image_quota_message` | string | Bước F. Tin gửi khi hết hạn mức đọc ảnh (tối đa 500 ký tự) |
| `image_summary_enabled` | boolean | Bước F. Mặc định `true`: AI trả thêm mô tả ngắn của ảnh, chỉ lưu cho quản trị, không gửi người dùng |
| `image_text_enabled` | boolean | Bước G. Mặc định `true`: AI chép chữ đọc được trên ảnh (tối đa 1.000 ký tự, thông tin cá nhân bọc `⟦…⟧`) vào `conversations.image_text`, chỉ quản trị xem trên màn Lịch sử, không gửi người dùng, không ghi log |
| `updated_at`, `updated_by` | | Trang quản trị ghi khi lưu Cài đặt |

Giá trị sai kiểu hoặc ngoài khoảng: hàm dùng mặc định và ghi cảnh báo "Cấu hình config/main". Hàm đọc lại cấu hình ở mỗi yêu cầu: sửa trong Console hoặc trang quản trị là có hiệu lực từ tin tiếp theo.

**Tắt AI khẩn cấp:** đặt `ai_enabled` = `false` (trang quản trị > Cài đặt, hoặc Firestore Console). Không cần triển khai lại. Chỉ tắt đọc ảnh: `image_ai_enabled` = `false`.

## Luồng xử lý một câu hỏi

1. Kiểm tra header bí mật, loại sự kiện, nhóm được phép, chống trùng theo `message_id` (ghi **trước** khi gọi AI), cắt @tên bot, hạn mức tin tháng.
2. `ai_enabled = false`: trả "Đã nhận: ..." như giai đoạn 1. Câu hỏi rỗng: gửi tin hướng dẫn.
3. Đọc các mục `approved` (bộ nhớ đệm 60 giây). Gọi Claude **một lần** với câu hỏi và danh sách mục (slug, tiêu đề, cách hỏi; **không gửi nội dung trả lời**). Đầu ra JSON `{slug, confidence}` được kiểm tra: JSON hợp lệ, slug có trong danh sách, confidence 0-1.
4. Slug hợp lệ và `confidence >= confidence_threshold`: gửi nguyên văn `answer` + link (`Nhãn: URL`), tối đa 2.000 ký tự.
   Mục có ảnh (bước E): `max_images_per_answer` ảnh đầu được gửi **sau** tin chữ, mỗi ảnh một tin `sendPhoto`, chú thích riêng hoặc "Bước i/n"; ảnh còn lại thành dòng `Ảnh i: URL` cuối tin chữ. Nếu đã gửi + 1 + số ảnh vượt `monthly_message_limit` thì chỉ gửi tin chữ, mọi ảnh thành link. Tin chữ lỗi thì không gửi ảnh; một ảnh lỗi thì ghi lỗi và gửi tiếp ảnh sau.
5. Không có slug, dưới ngưỡng, lỗi/hết giờ AI, hết hạn mức AI: gửi `handoff_message`, ghi `unanswered`.
6. Ghi `conversations`, `usage`, `stats_daily`, `hit_count`. Luôn trả HTTP 200.

**Tin ảnh (bước F, `message.image.received`):** chỉ xử lý khi chú thích có `@tên bot`, `ai_enabled` và `image_ai_enabled` cùng bật; nếu không thì `ignored` (`no_mention`, `image_ai_disabled`), không tải ảnh, không gọi AI. Hết `monthly_image_ai_limit` hoặc `monthly_ai_call_limit`: gửi `image_quota_message`. Hàm tải ảnh từ `photo_url` vào bộ nhớ (lỗi: gửi `handoff_message`, lý do `image_fetch_error`), gửi Claude ảnh base64 kèm chú thích đã cắt tên bot. Đầu ra `{slug, confidence, mo_ta, noi_dung_anh}` được kiểm tra như câu chữ; từ đó giống hệt bước 4-6. **Không lưu ảnh.** Bước G2: tin ảnh có gọi tên bot được lưu `photo_url` (link https của Zalo) vào `conversations` để quản trị xem lại; không bao giờ ghi vào log, `unanswered` hay gửi đi đâu khác. Spec: [spec/spec-buoc-F-doc-anh.md](spec/spec-buoc-F-doc-anh.md).

## Dữ liệu trong Firestore

| Nơi | Nội dung |
|---|---|
| `processed_events/{message_id}` | `received_at`, `state` (`processing`/`done`/`failed`), `expire_at` (+7 ngày, TTL tự xóa) |
| `conversations/{message_id}` | `chat_id`, `from_id`, `display_name`, `question`, `reply_text`, `outcome` (`replied`/`ignored`/`error`/`answered`/`handoff`), `ignore_reason`, `error`, `duration_ms`, `created_at`, `expire_at` (+90 ngày, TTL). Khi qua AI thêm `matched_slug`, `confidence`, `reason` (`no_match`/`low_confidence`/`ai_error`/`ai_quota`/`image_quota`/`image_fetch_error`), `ai_ms`, `send_ok`. Mục có ảnh thêm `images_sent`, `image_errors`, `images_as_links`. Tin ảnh (bước F) thêm `source: "image"`, `image_bytes`, `image_type`, `image_summary`, `fetch_ms`; bước G thêm `image_text` (chữ trên ảnh, thông tin cá nhân bọc `⟦…⟧`); bước G2 thêm `photo_url` (chỉ tin ảnh có gọi tên bot, link https ≤ 2.000 ký tự, nếu không thì `null`) |
| `usage/{YYYY-MM}` | `messages_sent` (đếm mọi lần gọi `sendMessage` và `sendPhoto`, kể cả lỗi), `send_errors`, `photos_sent`, `photo_errors`, `suggest_calls`, `suggest_errors`, `suggest_input_tokens`, `suggest_output_tokens` (nút gợi ý cách hỏi; không tính vào hạn mức AI của bot), `quota_warning_sent`, `ai_calls`, `ai_errors`, `ai_input_tokens`, `ai_output_tokens` (gồm cả lượt đọc ảnh), `image_ai_calls`, `image_ai_errors`, `image_input_tokens`, `image_output_tokens`, `image_fetch_errors` (bước F) (tháng theo giờ Việt Nam) |
| `stats_daily/{YYYY-MM-DD}` | `questions`, `answered`, `handoff`, `ai_errors`, `photos_sent`, `image_questions` (bước F), `item_hits.{slug}` (ngày theo giờ Việt Nam; chung mọi nhóm) |
| `pii_views/{auto}` | Bước G. Mỗi lần quản trị bấm "Hiện thông tin cá nhân" trên màn Lịch sử: `conversation_id`, `viewed_by`, `viewed_at`. Chỉ thêm, không sửa, không xóa |
| `unanswered/{id}` | Câu chuyển ca gộp theo câu đã chuẩn hóa (bỏ dấu, chữ thường). `cluster_key`, `samples` (≤ 3), `count`, `first_asked_at`, `last_asked_at`, `reason`, `best_guess_slug`, `best_guess_confidence`, `status` (`new`/`answered`/`ignored`), `answered_slug`, `answered_at`, `handled_by`. Tin ảnh (bước F): `source: "image"`, `image_summary`, mẫu có tiền tố `[Ảnh] `; ảnh không chú thích thì mỗi tin một bản ghi `img_{message_id}`. Không lưu mã người dùng. Hỏi lại câu đã xử lý mà bot vẫn chuyển ca thì về lại `new` |
| `kb_items/{slug}` | `title`, `topic`, `questions[]`, `answer` (≤ 1.500 ký tự), `links[]` (`label`, `url`, `platform`), `keywords[]`, `source`, `status` (`draft`/`approved`/`hidden`), `version`, `hit_count`, `last_hit_at`, `steps[]` (chừa cho nhập PDF), `images[]` (bước E: `url`, `path`, `caption`, `width`, `height`, `bytes`; tối đa 10; chỉ tải từ trang quản trị), `image_urls[]` (cũ, không còn ghi), `created_at`, `updated_at`, `updated_by`, `approved_at`, `approved_by`. Bot chỉ dùng `approved` |
| `eval_testset/t-NN` | Bộ thử cho `eval-run` (`stt`, `question`, `expected_slug`); bot không đọc |
| `admins/{uid}` | Tài khoản được dùng trang quản trị (bạn tạo thủ công) |
| `config/main` | Cấu hình ở trên |

`ignore_reason`: `unsupported_event:<event_name>`, `not_group:<chat_type>`, `no_mention`, `reply_disabled`, `quota`.
Nhóm không có trong danh sách: không ghi `conversations`, chỉ ghi dòng Cloud Logging "Nhóm không được phép" kèm `chat_id`.

## Phát triển và kiểm thử

| Phần | Lệnh | Ghi chú |
|---|---|---|
| Hàm | `cd functions`, `npm install`, `npm run build`, `npm test` | 187 kiểm thử |
| Script kho | `cd scripts/kb`, `npm install`, `npm test` | 50 kiểm thử |
| Trang quản trị | `cd admin`, `npm install`, `npm test` | 74 kiểm thử logic |
| Quy tắc Firestore và Storage | `cd admin`, `npm run test:rules` | 98 kiểm thử trên emulator, cần Java 21 (Temurin) |

## Triển khai

| Việc | Lệnh |
|---|---|
| Chỉ hàm | `firebase deploy --only functions` |
| Chỉ quy tắc và chỉ mục | `firebase deploy --only firestore` |
| Cả hai | `firebase deploy --only functions,firestore` |
| Quy tắc Storage (bước E) | `firebase deploy --only storage`. Chỉ chạy được **sau khi bật Storage** trong Console. Lần đầu CLI có thể hỏi cấp quyền cho Storage đọc Firestore (cần cho kiểm tra `admins`): trả lời Yes |
| Trang quản trị | Tải `admin/index.html` lên kho GitHub `zalo-bot-admin` (thay tệp cũ). Xem [admin/README.md](admin/README.md) |

Lần triển khai gần nhất: hàm có bước C (16/11/2026 16:21), quy tắc và chỉ mục bước D (16/11/2026). Bước E (16/11/2026): `firebase deploy --only storage`, rồi `--only firestore,functions`. Nên luôn dùng `--only` để triển khai đúng phần cần. Nếu `firebase deploy` báo lỗi "Failed to make request ... adminSdkConfig", chạy lại: thường là lỗi mạng tạm thời.

## Đăng ký webhook

```
npm --prefix functions run build
node scripts/check-bot.mjs      # kiểm tra token (getMe) và webhook hiện tại
node scripts/webhook-set.mjs    # đăng ký; phản hồi có verification.outcome = webhook.ok là đạt
node scripts/webhook-delete.mjs # xóa, khi cần quay lại getUpdates
```

Script đọc `ZALO_BOT_TOKEN`, `ZALO_WEBHOOK_SECRET`, `ZALO_WEBHOOK_URL` từ biến môi trường; nếu không có thì hỏi (bí mật được hỏi ẩn ký tự). Script in "dấu vân tay" (độ dài + 8 ký tự đầu SHA-256) để đối chiếu mà không lộ giá trị, và từ chối chuỗi có ký tự điều khiển (thường do Ctrl+V không dán được trong cmd).

## Thử nhanh bằng sự kiện mẫu

```
node scripts/send-sample.mjs --get            # mong đợi 405
node scripts/send-sample.mjs --no-secret      # mong đợi 401
node scripts/send-sample.mjs --wrong-secret   # mong đợi 401
node scripts/send-sample.mjs                  # 200; nhóm giả nên chỉ ghi "Nhóm không được phép"
node scripts/send-sample.mjs --id X; node scripts/send-sample.mjs --id X   # lần 2 là "Sự kiện trùng"
```

Cảnh báo: dùng `--chat` với mã nhóm có trong `allowed_chat_ids` thì bot gửi tin **thật** vào nhóm (trừ khi `--id` đã được xử lý). Khi `ai_enabled` bật, mỗi lần như vậy còn tốn một lượt gọi AI.

## Xem nhật ký

```
firebase functions:log --only zaloWebhook
```

Hoặc Firebase Console, Functions, Logs. Các dòng đáng chú ý: "Nhóm không được phép" (lấy mã nhóm), "Sự kiện trùng", "Đã xử lý sự kiện" (có `duration_ms`), "Đã dùng 80% hạn mức", "Gửi tin thất bại", lỗi AI (`timeout`, `api_<mã>`), "Cấu hình config/main". Nhật ký không ghi nội dung câu hỏi.

## Điều khác với tài liệu Zalo đã gặp

- `secret_token` chỉ nhận `A-Z a-z 0-9 _ -` (tài liệu chỉ nêu độ dài 8-256).
- `getWebhookInfo` trả `error_code 404 "Not Found"` khi chưa đăng ký webhook.
- `setWebhook` thành công trả `updated_at: 0`.
- Sau `setWebhook`, Zalo gửi yêu cầu thử `event_name: "webhook.test"`, `message_id: "webhook-test"`, không có `chat`/`from`, `date` tính bằng giây. Hàm bỏ qua và trả 200.
- Lỗi API trả HTTP 200 kèm `ok: false`, `error_code`, `description`.
- Bộ đếm tin của Zalo có vẻ tính cả lần gửi lỗi, nên `messages_sent` đếm mọi lần gọi `sendMessage`.
- `sendPhoto` gửi được ảnh từ link công khai, trả `message_type: "CHAT_PHOTO"`. Zalo máy tính hiện ô tải xuống thay vì ảnh cho tới khi bấm vào; điện thoại hiện ảnh bình thường (16/11/2026).
