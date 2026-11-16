import { describe, expect, it } from "vitest";
import { planImport } from "../lib/plan.mjs";
import { validateRow } from "../lib/validate.mjs";

const base = {
  slug: "doi-mat-khau",
  tieu_de: "Đổi mật khẩu",
  nhom: "Tài khoản",
  cach_hoi: "đổi mật khẩu\ndoi mk\nthay mật khẩu",
  tra_loi: "Vào Cài đặt > Đổi mật khẩu.",
  link: "",
  tu_khoa: "",
  nguon: "HDSD v2, trang 5",
  trang_thai: "draft",
};
const row = (values, rowNumber = 2) => ({ rowNumber, values: { ...base, ...values } });

/** Kho giả: dữ liệu như sau khi đã nạp `values`. */
function stored(values, extra = {}) {
  const { item } = validateRow({ ...base, ...values });
  const { slug, ...rest } = item;
  return [slug, { ...rest, version: 1, hit_count: 0, ...extra }];
}

describe("planImport", () => {
  it("kho trống → tạo mới, version 1; dòng ví dụ bị bỏ qua", () => {
    const p = planImport([row({ slug: "vi-du-1" }, 2), row({}, 3)], new Map());
    expect(p.skipped.length).toBe(1);
    expect(p.creates).toHaveLength(1);
    expect(p.creates[0]).toMatchObject({ slug: "doi-mat-khau", rowNumber: 3, data: { status: "draft", version: 1 } });
  });

  it("dòng chỉ có công thức do_dai_tra_loi hoặc ghi_chu → coi là dòng trống", () => {
    const blank = { slug: "", tieu_de: "", nhom: "", cach_hoi: "", tra_loi: "", do_dai_tra_loi: "0", link: "", tu_khoa: "", nguon: "", trang_thai: "", ghi_chu: "nháp" };
    const p = planImport([{ rowNumber: 9, values: blank }, row({}, 10)], new Map());
    expect(p.rejected).toEqual([]);
    expect(p.creates).toHaveLength(1);
  });

  it("nạp lại y hệt → không đổi, không tạo trùng", () => {
    const kb = new Map([stored({})]);
    const p = planImport([row({})], kb);
    expect(p.creates).toEqual([]);
    expect(p.updates).toEqual([]);
    expect(p.unchanged).toHaveLength(1);
  });

  it("mục draft đổi nội dung → cập nhật trường đổi, version tăng", () => {
    const kb = new Map([stored({}, { version: 3 })]);
    const p = planImport([row({ tra_loi: "Nội dung mới." })], kb);
    expect(p.updates).toHaveLength(1);
    expect(p.updates[0].data).toEqual({ answer: "Nội dung mới.", version: 4 });
    expect(p.updates[0].changedFields).toEqual(["answer"]);
  });

  it("chỉ đổi trạng thái draft → approved: không tăng version", () => {
    const kb = new Map([stored({})]);
    const p = planImport([row({ trang_thai: "approved" })], kb);
    expect(p.updates[0].data).toEqual({ status: "approved" });
    expect(p.updates[0].statusChange).toEqual(["draft", "approved"]);
  });

  it("mục approved đổi nội dung, không có cờ → xung đột, không ghi", () => {
    const kb = new Map([stored({ trang_thai: "approved" })]);
    const p = planImport([row({ trang_thai: "approved", tra_loi: "Sửa." })], kb);
    expect(p.updates).toEqual([]);
    expect(p.conflicts).toHaveLength(1);
    expect(p.conflicts[0].changedFields).toEqual(["answer"]);
  });

  it("mục approved, Excel ghi draft → không hạ trạng thái khi không có cờ", () => {
    const kb = new Map([stored({ trang_thai: "approved" })]);
    const p = planImport([row({ trang_thai: "draft" })], kb);
    expect(p.updates).toEqual([]);
    expect(p.conflicts[0].statusChange).toEqual(["approved", "draft"]);
  });

  it("có --ghi-de-approved → cập nhật, version tăng", () => {
    const kb = new Map([stored({ trang_thai: "approved" }, { version: 2 })]);
    const p = planImport([row({ trang_thai: "approved", tra_loi: "Sửa." })], kb, { overwriteApproved: true });
    expect(p.conflicts).toEqual([]);
    expect(p.updates[0].data).toEqual({ answer: "Sửa.", version: 3 });
  });

  it("slug trùng trong tệp → từ chối mọi dòng mang slug đó", () => {
    const p = planImport([row({}, 2), row({ tra_loi: "khác" }, 3)], new Map());
    expect(p.creates).toEqual([]);
    expect(p.rejected.map((r) => r.rowNumber)).toEqual([2, 3]);
  });

  it("dòng lỗi bị từ chối kèm lý do; dòng tốt vẫn nạp", () => {
    const rows = [
      row({ slug: "qua-dai", tra_loi: "x".repeat(1600) }, 2),
      row({ slug: "link-sai", link: "Video | http://a.com" }, 3),
      row({ slug: "" }, 4),
      row({ slug: "tot" }, 5),
    ];
    const p = planImport(rows, new Map());
    expect(p.rejected.map((r) => r.rowNumber)).toEqual([2, 3, 4]);
    expect(p.rejected[0].errors.join()).toContain("1600");
    expect(p.rejected[1].errors.join()).toContain("link không hợp lệ");
    expect(p.rejected[2].errors).toContain("slug trống");
    expect(p.creates.map((c) => c.slug)).toEqual(["tot"]);
  });

  it("mục có trong kho nhưng không có trong tệp → chỉ liệt kê, không xóa", () => {
    const kb = new Map([stored({ slug: "cu-1" }), stored({})]);
    const p = planImport([row({})], kb);
    expect(p.missing).toEqual(["cu-1"]);
  });

  it("mục hidden được cập nhật từ Excel (không phải approved)", () => {
    const kb = new Map([stored({ trang_thai: "hidden" })]);
    const p = planImport([row({ trang_thai: "draft" })], kb);
    expect(p.updates[0].statusChange).toEqual(["hidden", "draft"]);
  });
});
