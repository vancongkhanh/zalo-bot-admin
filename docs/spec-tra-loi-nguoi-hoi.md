# SPEC — Trả lời người đã hỏi từ trang quản trị (text only)

**Dự án:** Bot TTHC Đảng (Zalo Bot Platform + Firebase Cloud Functions Node.js + Firestore)
**Tính năng:** Từ tab "Câu chưa trả lời", admin soạn/gắn đáp án và gửi tin trả lời vào đúng nhóm/chat của người đã hỏi.
**Phiên bản:** v1 — chỉ gửi văn bản. Hình ảnh để phiên bản sau.
**Ngày:** 25/11/2026

---

## 0. Cách làm việc (bắt buộc cho Claude Code)

1. **Bước khảo sát trước, chưa sửa code:** đọc code hiện có và báo cáo lại (mục 3) trước khi triển khai.
2. Tên collection/trường trong spec là đề xuất. Nếu code hiện tại đã có tên tương đương thì **dùng tên hiện có**, ghi rõ ánh xạ trong báo cáo.
3. Làm tuần tự theo các bước ở mục 10, mỗi bước kiểm tra xong mới sang bước sau.
4. Không thay đổi hành vi hiện có của bot (trả lời tự động, lọc nhóm, thống kê) ngoài những gì spec nêu.

---

## 1. Phạm vi

| Trong phạm vi v1 | Ngoài phạm vi v1 |
|---|---|
| Lưu thông tin từng lượt hỏi (ai, ở nhóm nào, lúc nào, câu gốc) cho câu chưa trả lời | Gửi hình ảnh (`sendPhoto`) |
| Gửi tin văn bản trả lời vào nhóm/chat 1-1 của người hỏi | @mention/tag người dùng (API không hỗ trợ) |
| Gộp nhiều người hỏi trong cùng một nhóm thành 1 tin | Trả lời trích dẫn (quote) tin gốc (API không có tham số) |
| Xem trước, đếm ký tự, trạng thái gửi, thử lại khi lỗi | Zalo OA |
| Chống gửi trùng | Gửi hàng loạt tin chủ động không gắn với câu hỏi |

---

## 2. Ràng buộc từ Zalo Bot API

| Mục | Giá trị | Hệ quả thiết kế |
|---|---|---|
| Endpoint | `POST https://bot-api.zaloplatforms.com/bot<TOKEN>/sendMessage` | Gọi từ Cloud Function, **không** gọi từ trình duyệt |
| Tham số | `chat_id` (bắt buộc), `text` (bắt buộc, 1–2000 ký tự), `parse_mode` (tùy chọn) | Tin hoàn chỉnh (kể cả phần trích câu hỏi) ≤ 2000 ký tự |
| Mention / reply quote | Không có trong tài liệu | Ghi tên người hỏi và trích câu hỏi gốc dưới dạng văn bản |
| `parse_mode` | v1 **không dùng** (gửi text thuần) | Tránh lỗi do ký tự đặc biệt trong câu hỏi/đáp án của người dùng |
| Lấy ID nhóm | `message.chat.id` trong payload webhook | Lưu `chat_id` ở mỗi lượt hỏi |

**Điều kiện tiên quyết (Khánh test tay trước khi triển khai):** gọi `sendMessage` với `chat_id` của nhóm vào thời điểm không có ai @bot → tin phải hiện trong nhóm. Nếu thất bại, dừng triển khai và báo lại.

---

## 3. Khảo sát code hiện tại — báo cáo trước khi sửa

Claude Code đọc code và trả lời các câu sau:

| # | Câu hỏi |
|---|---|
| K1 | Webhook ghi câu chưa trả lời vào `unanswered` như thế nào? Cấu trúc document (doc ID, các trường, cơ chế gộp câu trùng / đếm "Hỏi N lần")? |
| K2 | Payload webhook hiện lưu những trường nào của người gửi (`from.id`, `from.display_name`) và `chat` (`id`, `chat_type`)? |
| K3 | Danh sách nhóm cho phép lưu ở đâu (`config` hay hard-code/env)? |
| K4 | Trang quản trị viết bằng gì (HTML/JS thuần, framework?), host ở đâu, đọc/ghi Firestore trực tiếp hay qua function? |
| K5 | Luồng nút "Soạn đáp án mới" và "Gắn vào mục có sẵn" hiện ghi gì vào `kb_items` và `unanswered`? Trạng thái "Đã duyệt" lưu ở trường nào? |
| K6 | Bot token đang lấy từ đâu (Secret Manager / env / config)? Có hàm dùng chung để gọi Zalo API chưa? |
| K7 | Tab "Lịch sử" đọc từ collection nào (`conversations`?), cấu trúc một tin? |
| K8 | Firestore Security Rules hiện tại cho các collection trên. |

---

## 4. Thay đổi dữ liệu

### 4.1. Lưu từng lượt hỏi

Subcollection mới: `unanswered/{unansweredId}/asks/{askId}`

| Trường | Kiểu | Nguồn / ghi chú |
|---|---|---|
| `chat_id` | string | `message.chat.id` |
| `chat_type` | string | `message.chat.chat_type` (giữ nguyên giá trị Zalo trả về) |
| `chat_name` | string \| null | Tên nhóm nếu lấy được từ config; không có thì null |
| `sender_id` | string | `message.from.id` |
| `sender_name` | string | `message.from.display_name` |
| `text` | string | Câu hỏi gốc (đã bỏ phần @bot), cắt tối đa 500 ký tự |
| `message_id` | string \| null | Nếu payload có |
| `asked_at` | timestamp | Thời điểm sự kiện |
| `reply_status` | string | `pending` \| `sent` \| `failed` \| `skipped` — mặc định `pending` |
| `replied_at` | timestamp \| null | |
| `reply_error` | string \| null | Mã/thông báo lỗi Zalo |
| `reply_batch_id` | string \| null | ID lần gửi (mục 5.3) |

- `askId`: tự sinh (auto ID).
- Ghi trong cùng thao tác webhook đang ghi/cập nhật `unanswered` (transaction hoặc batch nếu code hiện tại dùng).
- Câu hỏi cũ đã có trước khi triển khai **không có** `asks` → UI hiển thị "Không có thông tin người hỏi" và không cho gửi (chỉ lưu đáp án như hiện tại).

### 4.2. Thêm vào document `unanswered/{id}`

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `pending_ask_count` | number | Số lượt hỏi `pending` — tăng khi webhook thêm ask, giảm khi gửi xong/bỏ qua |

### 4.3. Lịch sử gửi

Collection mới: `admin_replies/{batchId}`

| Trường | Kiểu |
|---|---|
| `unanswered_id` | string |
| `kb_item_id` | string \| null |
| `answer_text` | string |
| `sent_by` | string (email admin) |
| `created_at` | timestamp |
| `results` | array `{ chat_id, ask_ids[], status, error, sent_at }` |

Nếu tab "Lịch sử" đọc từ `conversations` (K7): ghi thêm một bản ghi tin đi (outbound) cho mỗi `chat_id` gửi thành công, đánh dấu nguồn `admin_reply` để phân biệt với bot trả lời tự động.

---

## 5. Cloud Function gửi trả lời

### 5.0. Nguyên tắc bắt buộc: trả lời ĐÚNG nhóm đã hỏi

| Quy tắc | Chi tiết |
|---|---|
| R1 | `chat_id` đích **chỉ được lấy từ trường `chat_id` của chính ask** đã lưu lúc webhook nhận câu hỏi. Không lấy từ input client, không lấy từ config, không lấy "nhóm mặc định" |
| R2 | Input của hàm **không có** tham số `chat_id`. Client chỉ gửi `askIds`; server tự tra `chat_id` |
| R3 | Một người hỏi ở nhóm A và nhóm B là **2 ask riêng** → nhóm A chỉ nhận trả lời cho ask ở A, nhóm B chỉ nhận cho ask ở B. Không gộp ask khác `chat_id` vào cùng một tin |
| R4 | Tin gửi vào nhóm A chỉ được chứa tên/câu hỏi của người hỏi **trong nhóm A** (không lộ tên người ở nhóm khác) |
| R5 | Ask có `chat_id` rỗng/null → `failed` với lỗi `MISSING_CHAT_ID`, không gửi |
| R6 | Câu hỏi từ chat 1-1 → trả lời về đúng chat 1-1 đó, không gửi vào nhóm |
| R7 | Ghi log `chat_id` đích cạnh `ask_id` cho mỗi lần gửi để đối soát |

### 5.1. Hàm `sendReplyToAskers` (HTTPS callable, `onCall`)

**Xác thực:** người gọi phải đăng nhập Firebase Auth và có email nằm trong collection `admins`. Không đạt → lỗi `permission-denied`.

**Input:**

```json
{
  "unansweredId": "string",
  "answerText": "string",
  "askIds": ["string"],
  "kbItemId": "string | null"
}
```

**Xử lý:**

1. Validate: `answerText` không rỗng (sau trim); `askIds` không rỗng; mọi ask thuộc `unansweredId`.
2. Đọc các ask; **bỏ qua** ask có `reply_status = sent` (chống gửi trùng).
3. Gom ask theo `chat_id`.
4. Với mỗi `chat_id`:
   - Dựng tin theo mẫu mục 5.2.
   - Nếu > 2000 ký tự → không gửi, đánh dấu `failed` với lỗi `TEXT_TOO_LONG`.
   - Gọi `sendMessage`. Gửi **tuần tự**, nghỉ ~500 ms giữa các nhóm.
   - Thành công → các ask của nhóm đó: `reply_status = sent`, `replied_at`, `reply_batch_id`.
   - Lỗi → `reply_status = failed`, `reply_error` = mã/thông báo từ Zalo (hoặc lỗi mạng). Không retry tự động.
5. Cập nhật `pending_ask_count`.
6. Ghi `admin_replies/{batchId}`.
7. Tăng bộ đếm tin gửi trong `usage`/`stats_daily` theo cách code hiện tại đang đếm (nếu có).
8. Trả về:

```json
{
  "batchId": "string",
  "results": [
    { "chat_id": "…", "chat_name": "…", "ask_count": 2, "status": "sent|failed|skipped", "error": null }
  ]
}
```

**Token bot:** dùng đúng cơ chế hiện tại (K6); không bao giờ trả token về client.

### 5.2. Mẫu tin nhắn (text thuần)

Một người hỏi:

```
📌 Trả lời câu hỏi của {sender_name} ({HH:mm dd/MM}):
"{text gốc}"

{answerText}
```

Nhiều người hỏi trong cùng nhóm:

```
📌 Trả lời câu hỏi của {tên 1}, {tên 2}, {tên 3}:
"{text gốc của lượt hỏi gần nhất}"

{answerText}
```

- Quá 5 tên → hiển thị 5 tên đầu + "và N người khác".
- Câu gốc trong tin cắt tối đa 200 ký tự, thêm "…" nếu bị cắt.
- Giờ theo múi `Asia/Ho_Chi_Minh`.
- Hàm dựng tin để riêng (pure function), dùng chung cho xem trước ở UI (mục 6) và gửi thật — **đảm bảo xem trước khớp 100% với tin gửi đi**.

### 5.3. Hàm `skipAsks` (callable, tùy chọn nhưng nên có)

Input `{ unansweredId, askIds }` → đặt `reply_status = skipped`. Dùng khi admin không muốn gửi cho một số người (câu quá cũ, nhóm đã rời…).

---

## 6. Trang quản trị

### 6.1. Thẻ câu hỏi ở tab "Câu chưa trả lời"

- Thêm dòng nhỏ: **"N người hỏi · M nhóm"** (đọc từ `asks`, chỉ tính `pending`).
- Câu hỏi không có `asks` → "Không có thông tin người hỏi".

### 6.2. Trong hộp "Soạn đáp án mới" và "Gắn vào mục có sẵn"

Thêm khối **"Gửi trả lời cho người đã hỏi"** bên dưới phần đáp án:

| Thành phần | Hành vi |
|---|---|
| Checkbox tổng "Gửi trả lời cho người đã hỏi" | Mặc định **bật** nếu có ask `pending`; ẩn khối nếu không có |
| Danh sách ask `pending` | Mỗi dòng: checkbox · tên người hỏi · tên nhóm (hoặc "Chat riêng" / `chat_id` rút gọn) · thời gian · câu gốc. Mặc định chọn hết |
| Cảnh báo câu cũ | Ask quá **72 giờ** → nhãn vàng "Đã hỏi X ngày trước", mặc định **bỏ chọn** |
| Cảnh báo nhóm | `chat_id` dạng nhóm không còn trong danh sách nhóm cho phép (K3) → nhãn đỏ "Nhóm không còn trong cấu hình", mặc định bỏ chọn |
| Xem trước | Mỗi khối xem trước có tiêu đề **"Gửi vào: {tên nhóm / Chat riêng với {tên}}"** để admin thấy rõ tin nào đi nhóm nào. Hiển thị đúng tin sẽ gửi cho từng nhóm (dùng hàm dựng tin mục 5.2), cập nhật khi sửa đáp án |
| Bộ đếm ký tự | Hiện "x/2000" cho tin dài nhất; vượt 2000 → đỏ và khóa nút gửi |
| Với "Gắn vào mục có sẵn" | `answerText` = nội dung đáp án của mục kho tri thức được chọn (admin vẫn sửa được phần gửi đi trước khi gửi, không làm đổi mục kho) |

### 6.3. Nút và luồng

- Khi khối gửi được bật, nút chính đổi chữ: **"Duyệt & gửi (N nhóm)"**. Khi tắt: giữ nguyên hành vi hiện tại.
- Bấm nút → hộp xác nhận: "Gửi trả lời vào N nhóm/chat?" → Đồng ý.
- **Thứ tự:** (1) lưu đáp án vào kho + chuyển trạng thái như hiện tại → (2) gọi `sendReplyToAskers`.
  - Lưu kho thất bại → **không gửi**, báo lỗi.
  - Lưu kho thành công nhưng gửi lỗi một phần/toàn bộ → giữ đáp án đã lưu, hiển thị kết quả từng nhóm.
- Hiển thị kết quả: ✅ Đã gửi / ❌ Lỗi (kèm thông báo) + nút **"Gửi lại"** cho các nhóm lỗi (gọi lại hàm với các ask `failed`).
- Khóa nút trong lúc đang gửi (chống bấm 2 lần).

### 6.4. Ask phát sinh sau khi đã duyệt

Câu đã duyệt mà vẫn còn ask `pending` (người hỏi trong lúc chờ ~1 phút bot nạp kho, hoặc hỏi trước khi duyệt nhưng admin bỏ chọn) → vẫn hiện ở tab với nhãn **"Còn N người chưa được trả lời"** và nút **"Gửi trả lời"** (mở thẳng khối 6.2 với đáp án đã duyệt).

---

## 7. Bảo mật

| Mục | Yêu cầu |
|---|---|
| Firestore Rules | `unanswered/*/asks/*` và `admin_replies/*`: chỉ admin (email trong `admins`) được đọc; **client không được ghi** — chỉ Cloud Functions ghi |
| Token | Chỉ nằm phía server |
| Dữ liệu cá nhân | Tên người hỏi chỉ hiển thị trong trang quản trị và trong tin gửi lại đúng nhóm/chat đã hỏi; không gửi chéo sang nhóm khác |
| Log | Không log toàn bộ `answerText` hoặc token; log `batchId`, `chat_id`, trạng thái, mã lỗi |

---

## 8. Tiêu chí nghiệm thu

| # | Kịch bản | Kết quả mong đợi |
|---|---|---|
| A1 | Người dùng @bot hỏi câu không có trong kho ở nhóm A | `unanswered` có mục mới, `asks` có 1 bản ghi đúng `chat_id`, tên, câu gốc, `pending` |
| A2 | Hai người khác nhau hỏi cùng câu ở nhóm A và nhóm B | Cùng một mục `unanswered`, 2 ask, thẻ hiện "2 người hỏi · 2 nhóm" |
| A3 | Admin soạn đáp án, bật gửi, bấm "Duyệt & gửi (2 nhóm)" | Mỗi nhóm nhận đúng 1 tin theo mẫu; nội dung khớp xem trước; ask → `sent`; mục vào kho như cũ |
| A4 | Hai người cùng hỏi trong nhóm A | Nhóm A nhận **1 tin** liệt kê cả 2 tên |
| A5 | Bấm gửi lần 2 cho cùng các ask | Không gửi lại (ask đã `sent` bị bỏ qua) |
| A6 | Một `chat_id` sai/bot đã bị kick | Nhóm đó báo ❌ kèm lỗi Zalo; các nhóm khác vẫn gửi; "Gửi lại" chỉ gửi nhóm lỗi |
| A7 | Đáp án làm tin vượt 2000 ký tự | Bộ đếm đỏ, nút gửi bị khóa |
| A8 | Ask cũ > 72h | Có nhãn cảnh báo, mặc định bỏ chọn |
| A9 | Tắt checkbox gửi | Hành vi y như trước khi có tính năng (chỉ lưu kho) |
| A10 | "Gắn vào mục có sẵn" + gửi | Tin dùng nội dung mục kho; mục kho không bị thay đổi nếu admin sửa phần gửi đi |
| A11 | Người không phải admin gọi `sendReplyToAskers` | Bị từ chối `permission-denied` |
| A12 | Câu hỏi cũ (trước khi triển khai) | Hiện "Không có thông tin người hỏi", không có khối gửi, các nút cũ vẫn hoạt động |
| A13 | Bot trả lời tự động, lọc nhóm, thống kê | Không thay đổi |
| A14 | Cùng câu hỏi: người X hỏi ở nhóm A, người Y hỏi ở nhóm B, admin gửi | Nhóm A nhận tin chỉ có tên X; nhóm B nhận tin chỉ có tên Y; không nhóm nào nhận 2 tin |
| A15 | Cùng một người hỏi ở nhóm A và chat 1-1 với bot | Nhóm A nhận 1 tin, chat 1-1 nhận 1 tin; không nhầm chỗ |
| A16 | Admin chỉ tick ask ở nhóm A, bỏ tick ask ở nhóm B | Chỉ nhóm A nhận tin; ask nhóm B giữ `pending` |
| A17 | Gửi request giả mạo có thêm trường `chat_id` khác vào input | Server bỏ qua trường đó, vẫn gửi theo `chat_id` của ask |

---

## 9. Hướng mở rộng (không làm ở v1, chỉ để thiết kế không chặn)

- **Hình ảnh:** thêm `photoUrl` (Firebase Storage, URL tải trực tiếp) vào input; khi có ảnh dùng `sendPhoto` với `caption` = tin văn bản (≤ 2000 ký tự). Hàm dựng tin giữ nguyên.
- **Trả lời tin bất kỳ trong Lịch sử** (không chỉ câu chưa trả lời) — tái sử dụng `sendReplyToAskers` với nguồn ask khác.

---

## 10. Thứ tự triển khai

| Bước | Nội dung | Kiểm tra |
|---|---|---|
| 1 | Báo cáo khảo sát mục 3 | Khánh duyệt ánh xạ tên trường |
| 2 | Webhook ghi `asks` + `pending_ask_count` | A1, A2, A13 |
| 3 | Hàm dựng tin + `sendReplyToAskers` (+ `skipAsks`) | Gọi thử bằng Firebase emulator/console: A4, A5, A6, A11 |
| 4 | Firestore Rules | A11, client không ghi được `asks` |
| 5 | UI trang quản trị | A3, A7, A8, A9, A10, A12 |
| 6 | Lịch sử / thống kê | Tin admin gửi hiện trong "Lịch sử" với nhãn `admin_reply` |
