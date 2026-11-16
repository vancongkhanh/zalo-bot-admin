// Xuất kb_items ra Excel cùng định dạng sheet Kho, để sửa rồi nạp lại.
// Cách dùng: node kb-export.mjs <tệp.xlsx> [--ghi-de-tep]
import { existsSync } from "node:fs";
import { writeKho } from "./lib/excel.mjs";
import { getDb, loadKb } from "./lib/db.mjs";
import { fail, parseArgs, run } from "./lib/cli.mjs";

await run(async () => {
  const { flags, positional } = parseArgs();
  const file = positional[0];
  if (!file) fail("Cách dùng: node kb-export.mjs <tệp.xlsx> [--ghi-de-tep]");
  if (existsSync(file) && !flags.has("ghi-de-tep")) fail(`Tệp ${file} đã có. Thêm --ghi-de-tep để ghi đè.`);
  const kb = await loadKb(getDb());
  const items = [...kb.entries()]
    .map(([slug, d]) => ({ slug, ...d }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  await writeKho(file, items);
  console.log(`Đã xuất ${items.length} mục ra ${file}`);
});
