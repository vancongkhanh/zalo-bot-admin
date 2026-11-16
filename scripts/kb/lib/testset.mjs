// Kiểm tra các dòng sheet Bo_thu. Thuần, kiểm thử được.
import { validateTestRow } from "./validate.mjs";

/**
 * @param {Array<{rowNumber:number, values:Record<string,string>}>} rows
 * @param {Map<string, object>} kb  kho hiện có (để cảnh báo slug_dung chưa có)
 */
export function planTestset(rows, kb) {
  const ok = [];
  const bad = [];
  let skipped = 0;
  const ids = new Map();
  for (const r of rows) {
    const { item, errors, skip } = validateTestRow(r.values);
    if (skip) {
      skipped++;
      continue;
    }
    if (!item) {
      for (const e of errors) bad.push({ dong: r.rowNumber, loi: e });
      continue;
    }
    if (ids.has(item.id)) {
      bad.push({ dong: r.rowNumber, loi: `stt ${item.stt} trùng với dòng ${ids.get(item.id)}` });
      continue;
    }
    ids.set(item.id, r.rowNumber);
    ok.push({ ...item, dong: r.rowNumber });
  }
  const warn = ok
    .filter((t) => t.expected_slug && !kb.has(t.expected_slug))
    .map((t) => ({ dong: t.dong, cb: `slug_dung "${t.expected_slug}" chưa có trong kho` }));
  return { ok, bad, warn, skipped };
}
