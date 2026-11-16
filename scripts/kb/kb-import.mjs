// Nạp sheet Kho từ Excel vào Firestore kb_items.
// Cách dùng: node kb-import.mjs <tệp.xlsx> [--thu] [--ghi-de-approved]
//   --thu               chỉ in kế hoạch, không ghi gì
//   --ghi-de-approved   cho phép ghi đè mục đang approved (version tăng)
import { readSheet } from "./lib/excel.mjs";
import { applyPlan, getDb, loadKb } from "./lib/db.mjs";
import { isBlankKhoRow, planImport } from "./lib/plan.mjs";
import { printPlan } from "./lib/report.mjs";
import { parseArgs, requireFile, run } from "./lib/cli.mjs";

await run(async () => {
  const { flags, positional } = parseArgs();
  const file = positional[0];
  requireFile(file, "node kb-import.mjs <tệp.xlsx> [--thu] [--ghi-de-approved]");

  const { rows } = await readSheet(file, "Kho");
  const db = getDb();
  const existing = await loadKb(db);
  const plan = planImport(rows, existing, { overwriteApproved: flags.has("ghi-de-approved") });
  const rowCount = rows.filter((r) => !isBlankKhoRow(r.values)).length;
  printPlan(plan, { file, rowCount, existingCount: existing.size });

  if (flags.has("thu")) {
    console.log("\nChạy thử (--thu): không ghi gì vào Firestore.");
    return;
  }
  const n = await applyPlan(db, plan);
  console.log(`\nĐã ghi ${n} thao tác vào kb_items.`);
});
