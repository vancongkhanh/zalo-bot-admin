# SPEC — Thêm câu hỏi người dùng vào "câu hỏi gợi ý" từ tab Lịch sử

**Dự án:** Bot TTHC Đảng (Firebase Cloud Functions Node.js + Firestore + trang quản trị)
**Tính năng:** Ở tab "Lịch sử", với lượt bot **trả lời được** bằng một mục kho tri thức, admin bấm một nút để đưa câu người dùng đã hỏi vào danh sách câu hỏi gợi ý của mục đó, giúp bot nhận diện tốt hơn các cách hỏi khác nhau.
**Quan hệ với spec khác:** Độc lập với `spec-tra-loi-nguoi-hoi.md`, có thể làm trước hoặc sau.
**Ngày:** 25/11/2026

---

## 0. Cách làm việc (bắt buộc cho Claude Code)

1. Khảo sát code (mục 2) và báo cáo **trước** khi sửa.
2. Tên trường trong spec là đề xuất; nếu code đã có tên tương đương thì dùng tên hiện có và ghi rõ ánh xạ.
3. Không thay đổi cách bot tìm/trả lời ngoài việc có thêm câu gợi ý trong dữ liệu.

---

## 1. Phạm vi

| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Nút "Thêm vào câu gợi ý" trên thẻ Lịch sử có kết quả **Trả lời được** | Lượt *chuyển ca*, *lỗi*, *bot không trả lời*, câu chưa trả lời (đã có luồng riêng ở tab "Câu chưa trả lời") |
| Sửa nội dung câu trước khi lưu (sửa lỗi chính tả, bỏ phần thừa) | Thêm hàng loạt nhiều câu một lúc |
| Chọn lại mục kho nếu bot chọn sai | Tự động thêm không qua admin duyệt |
| Kiểm tra trùng trong cùng mục và ở mục khác | Gợi ý tự động câu nào nên thêm |
| Đánh dấu thẻ Lịch sử đã được thêm | |

---

## 2. Khảo sát code — báo cáo trước khi sửa

| # | Câu hỏi |
|---|---|
| G1 | Document `kb_items/{id}` có trường nào chứa "câu hỏi gợi ý / câu hỏi mẫu / biến thể câu hỏi"? Kiểu dữ liệu (mảng string hay mảng object)? |
| G2 | Bot dùng danh sách này **như thế nào** khi tìm mục: đưa vào prompt AI, so khớp từ khóa, hay embedding/vector? Nếu có embedding → khi thêm câu có phải tính lại embedding không, tính ở đâu? |
| G3 | Danh sách câu gợi ý có được **hiển thị cho người dùng Zalo** không (ví dụ "Bạn có thể hỏi: …")? |
| G4 | Thẻ Lịch sử đọc từ collection nào, mỗi bản ghi có trường ID mục kho (ví dụ `dang-vien-co-hs-lay-y-kien-khi-bam-nhan-xet`), câu gốc, kết quả, độ tin cậy ở trường nào? |
| G5 | Trang quản trị hiện ghi vào `kb_items` trực tiếp từ client (theo Rules) hay qua Cloud Function? Cơ chế bot nạp lại kho (~1 phút) hoạt động thế nào? |
| G6 | Tab "Kho tri thức" có màn sửa danh sách câu gợi ý chưa? |

**Nếu G2 cho thấy cần tính embedding:** việc thêm câu phải đi qua Cloud Function để tính embedding cùng lúc; không ghi thẳng từ client.

---

## 3. Điều kiện hiển thị nút

Nút **"Thêm vào câu gợi ý"** chỉ hiện khi **đồng thời**:

| Điều kiện | Ghi chú |
|---|---|
| Kết quả = **Trả lời được** | Ẩn với chuyển ca, lỗi, bot không trả lời |
| Bản ghi có ID mục kho đã chọn | |
| Mục kho đó **vẫn còn tồn tại** và đang hoạt động/đã duyệt | Mục đã xóa → ẩn nút |
| Câu gốc là văn bản, không rỗng | Tin chỉ có ảnh → ẩn nút |
| Câu chưa được thêm từ chính bản ghi này | Đã thêm → hiện nhãn "✓ Đã thêm vào gợi ý" thay cho nút |

Vị trí: cạnh nút **"Mở mục"** ở cuối thẻ.

---

## 4. Hộp thoại thêm câu

| Thành phần | Hành vi |
|---|---|
| Ô nội dung | Điền sẵn câu gốc của người dùng **đã làm sạch**: bỏ phần `@Tên bot`, gộp khoảng trắng thừa, trim. Admin sửa được |
| Mục kho đích | Mặc định = mục bot đã chọn, hiển thị tiêu đề + ID. Có ô chọn/tìm để **đổi sang mục khác** |
| Cảnh báo độ tin cậy | Độ tin cậy < **0.85** → nhãn vàng: "Bot chọn mục này với độ tin cậy thấp (0.80). Kiểm tra đúng mục trước khi thêm." (ngưỡng đặt trong config, mặc định 0.85) |
| Danh sách câu gợi ý hiện có của mục đích | Hiển thị (thu gọn được) để admin thấy đã có câu tương tự chưa |
| Kiểm tra độ dài | 5–300 ký tự; ngoài khoảng → khóa nút Lưu |
| Nếu G3 = có hiển thị cho người dùng | Thêm dòng nhắc: "Câu này có thể hiển thị cho người dùng — kiểm tra chính tả." |
| Nút | **Lưu** / Hủy |

---

## 5. Kiểm tra trùng

So sánh trên chuỗi **chuẩn hóa**: chữ thường, bỏ dấu câu, gộp khoảng trắng (giữ nguyên dấu tiếng Việt).

| Trường hợp | Xử lý |
|---|---|
| Đã có trong **chính mục đích** | Không thêm; báo "Câu này đã có trong mục." Vẫn đánh dấu bản ghi Lịch sử là đã xử lý |
| Đã có trong **mục khác** | Cảnh báo đỏ: "Câu này đang là gợi ý của mục *{tên mục}*." — cho phép: **Hủy** hoặc **Vẫn thêm** (cần xác nhận lần 2) |
| Chưa có | Thêm bình thường |

Kiểm tra trùng thực hiện **phía server** khi lưu (client kiểm tra trước để báo sớm, nhưng server là chốt chặn cuối).

---

## 6. Ghi dữ liệu

### 6.1. Mục kho

- Thêm câu vào trường danh sách câu gợi ý của `kb_items/{id}` (tên theo G1), **không ghi đè** danh sách cũ (dùng `arrayUnion` hoặc transaction tùy kiểu dữ liệu).
- Nếu cần embedding (G2) → tính và lưu cùng lúc, trong cùng Cloud Function.
- Cập nhật `updated_at` của mục để bot nạp lại kho như cơ chế hiện tại.
- Mục có > **50** câu gợi ý → vẫn cho thêm nhưng hiện cảnh báo "Mục đã có nhiều câu gợi ý" (tránh phình prompt/chi phí AI). Ngưỡng đặt trong config.

### 6.2. Nhật ký

Collection mới `kb_suggestion_log/{autoId}`:

| Trường | Kiểu |
|---|---|
| `kb_item_id` | string |
| `question` | string (bản đã lưu) |
| `original_text` | string (câu gốc người dùng) |
| `history_ref` | string (ID bản ghi Lịch sử) |
| `confidence` | number |
| `item_changed` | boolean (admin có đổi mục so với bot chọn không) |
| `duplicate_in_other_item` | string \| null |
| `added_by` | string (email admin) |
| `added_at` | timestamp |

### 6.3. Bản ghi Lịch sử

Ghi thêm vào bản ghi Lịch sử tương ứng: `suggestion_added_at`, `suggestion_kb_item_id` → để hiện nhãn "✓ Đã thêm vào gợi ý" và chống thêm lặp.

---

## 7. Bảo mật

| Mục | Yêu cầu |
|---|---|
| Quyền | Chỉ admin (email trong `admins`) |
| Đường ghi | Theo cơ chế hiện tại của trang quản trị (G5). Nếu cần embedding hoặc kiểm tra trùng phía server → dùng Cloud Function callable `addSuggestedQuestion` |
| Rules | `kb_suggestion_log`: admin đọc, client không ghi |

---

## 8. Tiêu chí nghiệm thu

| # | Kịch bản | Kết quả mong đợi |
|---|---|---|
| S1 | Thẻ Lịch sử "Trả lời được" | Có nút "Thêm vào câu gợi ý" cạnh "Mở mục" |
| S2 | Thẻ chuyển ca / lỗi / bot không trả lời | Không có nút |
| S3 | Bấm nút | Hộp thoại điền sẵn câu đã bỏ `@bot`, mục đích = mục bot chọn |
| S4 | Lưu | Câu xuất hiện trong danh sách gợi ý của mục (xem ở tab Kho tri thức); các câu cũ còn nguyên |
| S5 | Mở lại thẻ Lịch sử đó | Hiện "✓ Đã thêm vào gợi ý", không còn nút |
| S6 | Thêm câu đã có trong cùng mục | Báo đã có, không tạo bản trùng |
| S7 | Thêm câu đang có ở mục khác | Cảnh báo đỏ, phải xác nhận lần 2 mới thêm |
| S8 | Độ tin cậy 0.80 | Có cảnh báo vàng, đổi được sang mục khác |
| S9 | Đổi mục rồi lưu | Câu vào đúng mục mới; log `item_changed = true` |
| S10 | Sau ~1 phút, người dùng @bot hỏi **đúng câu vừa thêm** | Bot chọn đúng mục, độ tin cậy ≥ lần trước |
| S11 | Người không phải admin | Không thực hiện được |
| S12 | Mục kho đã bị xóa | Thẻ Lịch sử không có nút |

---

## 9. Thứ tự triển khai

| Bước | Nội dung | Kiểm tra |
|---|---|---|
| 1 | Báo cáo khảo sát G1–G6 | Khánh duyệt |
| 2 | Hàm/logic ghi (kiểm trùng, embedding nếu có, log, đánh dấu Lịch sử) | S4, S6, S7, S11 |
| 3 | UI: nút + hộp thoại + nhãn đã thêm | S1–S3, S5, S8, S9, S12 |
| 4 | Kiểm tra hiệu quả | S10 |
