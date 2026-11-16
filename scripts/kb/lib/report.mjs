// In báo cáo kế hoạch nạp (dùng chung cho kb-import và kiểm thử).
import { printTable } from "./cli.mjs";

const ROW = { key: "dong", label: "Dòng", max: 5 };
const SLUG = { key: "slug", label: "slug", max: 36 };

export function printPlan(plan, { file, rowCount, existingCount }) {
  console.log(`\nTệp: ${file}  (${rowCount} dòng có dữ liệu; kho hiện có ${existingCount} mục)`);

  console.log(`\nMỤC MỚI: ${plan.creates.length}`);
  printTable(
    plan.creates.map((c) => ({ dong: c.rowNumber, slug: c.slug, tt: c.data.status, tieu_de: c.data.title })),
    [ROW, SLUG, { key: "tt", label: "Trạng thái", max: 10 }, { key: "tieu_de", label: "Tiêu đề", max: 40 }],
  );

  console.log(`\nCẬP NHẬT: ${plan.updates.length}`);
  printTable(
    plan.updates.map((u) => ({
      dong: u.rowNumber,
      slug: u.slug,
      truong: u.changedFields.join(", ") || "(chỉ trạng thái)",
      tt: u.statusChange ? u.statusChange.join(" → ") : "",
    })),
    [ROW, SLUG, { key: "truong", label: "Trường đổi", max: 50 }, { key: "tt", label: "Trạng thái", max: 22 }],
  );

  console.log(`\nKHÔNG ĐỔI: ${plan.unchanged.length}`);

  console.log(`\nKHÁC VỚI MỤC APPROVED (không ghi): ${plan.conflicts.length}`);
  printTable(
    plan.conflicts.map((c) => ({
      dong: c.rowNumber,
      slug: c.slug,
      truong: c.changedFields.join(", ") || "(chỉ trạng thái)",
      tt: c.statusChange ? c.statusChange.join(" → ") : "",
    })),
    [ROW, SLUG, { key: "truong", label: "Trường khác", max: 50 }, { key: "tt", label: "Trạng thái", max: 22 }],
  );
  if (plan.conflicts.length) console.log("  → Muốn ghi đè: chạy lại với --ghi-de-approved");

  console.log(`\nBỊ TỪ CHỐI: ${plan.rejected.length}`);
  printTable(
    plan.rejected.flatMap((r) => r.errors.map((e) => ({ dong: r.rowNumber, slug: r.slug, loi: e }))),
    [ROW, { key: "slug", label: "slug", max: 30 }, { key: "loi", label: "Lý do", max: 80 }],
  );

  console.log(`\nCẢNH BÁO: ${plan.warnings.length}`);
  printTable(
    plan.warnings.map((w) => ({ dong: w.rowNumber, slug: w.slug, cb: w.warning })),
    [ROW, { key: "slug", label: "slug", max: 30 }, { key: "cb", label: "Cảnh báo", max: 80 }],
  );

  console.log(`\nBỎ QUA (dòng ví dụ): ${plan.skipped.length}`);
  if (plan.missing.length) {
    console.log(`\nCó trong kho nhưng không có trong tệp (giữ nguyên, không xóa): ${plan.missing.join(", ")}`);
  }
}
