# Script kho tri thức (bước B)

Nạp, xuất, duyệt kho `kb_items` từ Excel. Chạy trên máy bạn, ghi thẳng vào Firestore dự án trong `.firebaserc`.
Không đụng `zaloWebhook`, `config/main`, `usage`, `conversations`, `processed_events`.

## Chuẩn bị (một lần)

1. Cài Google Cloud CLI: https://cloud.google.com/sdk/docs/install (bản Windows).
2. Đăng nhập Application Default Credentials (mở trình duyệt, chọn tài khoản Google sở hữu dự án Firebase):
   ```
   gcloud auth application-default login
   ```
   Tệp đăng nhập nằm trong `%APPDATA%\gcloud`, ngoài thư mục dự án. **Không tạo tệp khóa dịch vụ.**
3. Cài gói: `cd scripts/kb` rồi `npm install`.

Tệp Excel dữ liệu thật đặt trong `input/` (thư mục này không được commit).

## Lệnh (chạy trong `scripts/kb`)

| Lệnh | Việc |
|---|---|
| `node kb-import.mjs ../../input/kho.xlsx --thu` | Chạy thử: in kế hoạch (mới, cập nhật, không đổi, xung đột, từ chối, cảnh báo), **không ghi** |
| `node kb-import.mjs ../../input/kho.xlsx` | Nạp thật |
| `node kb-import.mjs ../../input/kho.xlsx --ghi-de-approved` | Cho phép ghi đè mục đang `approved` (version tăng) |
| `node kb-export.mjs ../../input/kho-xuat.xlsx` | Xuất kho ra Excel cùng cột (thêm `--ghi-de-tep` nếu tệp đã có) |
| `node kb-approve.mjs slug-1 slug-2` | Duyệt (cần có trả lời, ≥ 2 cách hỏi, có nguồn) |
| `node kb-hide.mjs slug-1` | Ẩn: bot không dùng, mục vẫn còn |
| `node kb-list.mjs [--trang-thai=approved]` | Liệt kê |
| `node eval-import-testset.mjs ../../input/kho.xlsx [--thu]` | Nạp sheet `Bo_thu` vào `eval_testset` |
| `node eval-run.mjs [--model=haiku\|sonnet] [--nguong=0.7] [--gioi-han=N]` | Chạy bộ thử qua đúng hàm chọn mục của bot (bước C). Không gửi Zalo, không ghi gì vào Firestore. **Tốn phí API** |
| `npm test` | Kiểm thử đơn vị (không cần mạng) |

## Quy tắc nạp

- Dòng có `slug` bắt đầu bằng `vi-du` và dòng trống bị bỏ qua. Cột `do_dai_tra_loi` (công thức) và `ghi_chu` không nạp.
- Từ chối dòng: `slug` trống, sai định dạng hoặc trùng trong tệp (mọi dòng trùng); `tieu_de` hoặc `tra_loi` trống; `tra_loi` quá 1.500 ký tự; link không phải `Nhãn | https://...`; `trang_thai` khác `draft`, `approved`, `hidden`.
- `cach_hoi` dưới 2 cách hoặc `nguon` trống: cảnh báo nếu `draft`, từ chối nếu `approved`.
- Link không có nhãn: nhãn tự đặt theo nền tảng (YouTube, Facebook, Drive, Liên kết).
- Mục mới: `version` 1. Nội dung đổi: `version` tăng; chỉ đổi trạng thái thì không.
- Mục đang `approved`: không bị ghi đè hay hạ trạng thái nếu không có `--ghi-de-approved`; script báo trường khác.
- Mục có trong kho nhưng không còn trong tệp: giữ nguyên, chỉ liệt kê. Script **không bao giờ xóa** mục.
- `approved_by`: `kb-import` (duyệt qua Excel) hoặc `kb-approve`.

## Bộ thử (`Bo_thu`)

Cột `stt`, `cau_hoi_that`, `slug_dung`, `ghi_chu`. Mã tài liệu `t-01`, `t-02`… theo `stt`; nạp lại ghi đè câu cùng `stt`, không xóa câu cũ. `slug_dung` trống = bot đúng khi chuyển ca. Cảnh báo nếu `slug_dung` chưa có trong kho.

## Đo chất lượng (`eval-run`, bước C)

1. Build hàm một lần (sau mỗi lần sửa mã hàm): `cd functions` rồi `npm run build`.
2. Khóa Anthropic cho máy bạn: đăng nhập `ant auth login`, hoặc đặt biến môi trường `ANTHROPIC_API_KEY` trong cửa sổ cmd hiện tại (`set ANTHROPIC_API_KEY=...`, chỉ có hiệu lực trong cửa sổ đó). Không ghi khóa vào tệp trong dự án.
3. Chạy `node scripts/kb/eval-run.mjs --model=haiku` rồi `--model=sonnet` để so.

Ngưỡng và model mặc định lấy từ `config/main`. Kết luận: `đúng`, `SAI MỤC`, `chuyển ca đúng`, `chuyển ca thừa`, `TRẢ LỜI SAI KHI KHO KHÔNG CÓ`, `lỗi AI`. Mục mong đợi chưa `approved` được tính như kho không có.
