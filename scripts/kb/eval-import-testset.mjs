// Nạp sheet Bo_thu vào Firestore eval_testset (tách riêng khỏi kb_items).
// Cách dùng: node eval-import-testset.mjs <tệp.xlsx> [--thu]
// Mã tài liệu theo stt (t-01, t-02...). Nạp lại ghi đè câu cùng stt, không xóa câu cũ.
import { FieldValue } from "firebase-admin/firestore";
import { readSheet } from "./lib/excel.mjs";
import { getDb, loadKb, TESTSET } from "./lib/db.mjs";
import { parseArgs, printTable, requireFile, run } from "./lib/cli.mjs";
import { planTestset } from "./lib/testset.mjs";

await run(async () => {
  const { flags, positional } = parseArgs();
  const file = positional[0];
  requireFile(file, "node eval-import-testset.mjs <tệp.xlsx> [--thu]");

  const { rows } = await readSheet(file, "Bo_thu");
  const db = getDb();
  const kb = await loadKb(db);
  const { ok, bad, warn, skipped } = planTestset(rows, kb);

  const handoff = ok.filter((t) => !t.expected_slug).length;
  console.log(`\nHợp lệ: ${ok.length} câu (${handoff} câu mong đợi chuyển ca). Bỏ qua: ${skipped}.`);
  console.log(`\nBỊ TỪ CHỐI: ${bad.length}`);
  printTable(bad, [{ key: "dong", label: "Dòng", max: 5 }, { key: "loi", label: "Lý do", max: 80 }]);
  console.log(`\nCẢNH BÁO: ${warn.length}`);
  printTable(warn, [{ key: "dong", label: "Dòng", max: 5 }, { key: "cb", label: "Cảnh báo", max: 80 }]);

  if (flags.has("thu")) {
    console.log("\nChạy thử (--thu): không ghi gì.");
    return;
  }
  const batch = db.batch();
  for (const t of ok) {
    batch.set(db.collection(TESTSET).doc(t.id), {
      stt: t.stt,
      question: t.question,
      expected_slug: t.expected_slug,
      imported_at: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  console.log(`\nĐã ghi ${ok.length} câu vào ${TESTSET}.`);
});
