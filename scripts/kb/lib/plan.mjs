// Lập kế hoạch nạp: so các dòng Excel đã kiểm tra với kho hiện có.
// Thuần (không gọi Firestore) để kiểm thử được. Không bao giờ xóa mục.
import { CONTENT_FIELDS, diffContent, isExampleSlug, validateRow } from "./validate.mjs";

export const IMPORT_APPROVER = "kb-import";

/** Cột không tính khi xét dòng trống: do_dai_tra_loi là công thức trong tệp mẫu; ghi_chu, so_anh không nạp. */
const IGNORED_FOR_BLANK = new Set(["do_dai_tra_loi", "ghi_chu", "so_anh"]);

export function isBlankKhoRow(values) {
  return Object.entries(values).every(([k, v]) => IGNORED_FOR_BLANK.has(k) || !String(v ?? "").trim());
}

/**
 * @param {Array<{rowNumber:number, values:Record<string,string>}>} rows  dòng sheet Kho
 * @param {Map<string, object>} existing  slug → tài liệu kb_items hiện có
 * @param {{overwriteApproved?: boolean}} opts
 * @returns {{ creates, updates, unchanged, conflicts, rejected, skipped, warnings, missing }}
 *   creates/updates: [{ slug, rowNumber, data, changedFields, statusChange }]
 */
export function planImport(allRows, existing, opts = {}) {
  const overwrite = !!opts.overwriteApproved;
  const rows = allRows.filter((r) => !isBlankKhoRow(r.values));
  const result = { creates: [], updates: [], unchanged: [], conflicts: [], rejected: [], skipped: [], warnings: [], missing: [] };

  // Trùng slug trong tệp: từ chối mọi dòng mang slug đó.
  const count = new Map();
  for (const r of rows) {
    const s = String(r.values.slug ?? "").trim();
    if (s) count.set(s, (count.get(s) ?? 0) + 1);
  }

  const seen = new Set();
  for (const r of rows) {
    const rawSlug = String(r.values.slug ?? "").trim();
    if (isExampleSlug(rawSlug)) {
      result.skipped.push({ rowNumber: r.rowNumber, slug: rawSlug, reason: "dòng ví dụ" });
      continue;
    }
    if (rawSlug && count.get(rawSlug) > 1) {
      result.rejected.push({ rowNumber: r.rowNumber, slug: rawSlug, errors: [`slug "${rawSlug}" trùng trong tệp (${count.get(rawSlug)} dòng)`] });
      continue;
    }
    const { item, errors, warnings } = validateRow(r.values);
    for (const w of warnings) result.warnings.push({ rowNumber: r.rowNumber, slug: rawSlug, warning: w });
    if (!item) {
      result.rejected.push({ rowNumber: r.rowNumber, slug: rawSlug, errors });
      continue;
    }
    seen.add(item.slug);
    const old = existing.get(item.slug);

    if (!old) {
      const data = { ...pickContent(item), status: item.status, version: 1 };
      result.creates.push({ slug: item.slug, rowNumber: r.rowNumber, data, changedFields: [...CONTENT_FIELDS], statusChange: [null, item.status] });
      continue;
    }

    const changedFields = diffContent(item, old);
    const statusDiffers = item.status !== old.status;
    if (!changedFields.length && !statusDiffers) {
      result.unchanged.push({ slug: item.slug, rowNumber: r.rowNumber });
      continue;
    }

    if (old.status === "approved" && !overwrite) {
      result.conflicts.push({
        slug: item.slug,
        rowNumber: r.rowNumber,
        changedFields,
        statusChange: statusDiffers ? [old.status, item.status] : null,
        reason: "mục đang approved; dùng --ghi-de-approved để ghi đè",
      });
      continue;
    }

    const data = {};
    for (const f of changedFields) data[f] = item[f];
    if (changedFields.length) data.version = (Number(old.version) || 1) + 1;
    if (statusDiffers) data.status = item.status;
    result.updates.push({
      slug: item.slug,
      rowNumber: r.rowNumber,
      data,
      changedFields,
      statusChange: statusDiffers ? [old.status, item.status] : null,
    });
  }

  for (const slug of existing.keys()) if (!seen.has(slug)) result.missing.push(slug);
  result.missing.sort();
  return result;
}

function pickContent(item) {
  const out = {};
  for (const f of CONTENT_FIELDS) out[f] = item[f];
  return out;
}
