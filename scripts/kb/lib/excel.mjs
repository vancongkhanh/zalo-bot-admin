// Đọc và ghi tệp Excel kho tri thức (exceljs).
import ExcelJS from "exceljs";
import { charLength, formatLinks } from "./validate.mjs";

export const KHO_COLUMNS = [
  "slug", "tieu_de", "nhom", "cach_hoi", "tra_loi", "do_dai_tra_loi",
  "link", "tu_khoa", "nguon", "trang_thai", "ghi_chu",
];

/** Giá trị ô exceljs → chuỗi (rich text, công thức, hyperlink, số, ngày). */
export function cellText(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v.richText)) return v.richText.map((r) => r.text ?? "").join("");
  if ("result" in v) return cellText(v.result);
  if ("text" in v) return cellText(v.text);
  if ("hyperlink" in v) return String(v.hyperlink);
  return String(v);
}

/** Đọc một sheet thành mảng { rowNumber, values: {cột: chuỗi} } theo hàng tiêu đề đầu tiên. */
export async function readSheet(path, sheetName) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error(`Không thấy sheet "${sheetName}" trong ${path}`);
  const header = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    header[col] = cellText(cell.value).trim();
  });
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = {};
    let any = false;
    header.forEach((name, col) => {
      if (!name) return;
      const t = cellText(row.getCell(col).value);
      values[name] = t;
      if (t.trim()) any = true;
    });
    if (any) rows.push({ rowNumber, values });
  });
  return { header: header.filter(Boolean), rows };
}

/** Mục kho → các giá trị cột Excel. */
export function itemToRow(item) {
  return {
    slug: item.slug,
    tieu_de: item.title ?? "",
    nhom: item.topic ?? "",
    cach_hoi: (item.questions ?? []).join("\n"),
    tra_loi: item.answer ?? "",
    do_dai_tra_loi: charLength(item.answer ?? ""),
    link: formatLinks(item.links),
    tu_khoa: (item.keywords ?? []).join(", "),
    nguon: item.source ?? "",
    trang_thai: item.status ?? "draft",
    ghi_chu: "",
  };
}

/** Ghi danh sách mục ra tệp Excel, sheet Kho, cùng cột với tệp mẫu. */
export async function writeKho(path, items) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Kho");
  const widths = { slug: 28, tieu_de: 32, nhom: 16, cach_hoi: 40, tra_loi: 60, do_dai_tra_loi: 10, link: 40, tu_khoa: 24, nguon: 24, trang_thai: 12, ghi_chu: 20 };
  ws.columns = KHO_COLUMNS.map((key) => ({ header: key, key, width: widths[key] }));
  ws.getRow(1).font = { bold: true };
  for (const item of items) ws.addRow(itemToRow(item));
  ws.eachRow((row, n) => {
    if (n > 1) row.alignment = { wrapText: true, vertical: "top" };
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  await wb.xlsx.writeFile(path);
}
