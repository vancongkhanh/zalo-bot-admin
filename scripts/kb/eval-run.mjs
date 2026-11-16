// Chạy bộ thử eval_testset qua đúng hàm chọn mục của bot. Không gửi tin Zalo,
// không ghi conversations, stats_daily, usage hay unanswered.
//
// Cách dùng: node eval-run.mjs [--model=haiku|sonnet|<mã model>] [--nguong=0.7] [--gioi-han=N]
//   Cần build hàm trước: cd functions && npm run build
//   Khóa Anthropic: biến môi trường ANTHROPIC_API_KEY hoặc hồ sơ `ant auth login` (không ghi khóa vào tệp).
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, KB, TESTSET } from "./lib/db.mjs";
import { fail, parseArgs, printTable, run } from "./lib/cli.mjs";
import { estimateCost, judge, resolveModel, VERDICTS } from "./lib/eval.mjs";

const FUNCTIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "functions");
if (!existsSync(join(FUNCTIONS, "lib", "selector.js"))) {
  fail("Chưa build hàm. Chạy: cd functions && npm run build");
}
// Dùng chính mã đã build của bot để kết quả khớp với lúc chạy thật.
const requireFn = createRequire(join(FUNCTIONS, "package.json"));
const { selectItem } = requireFn("./lib/selector.js");
const { toKbItem } = requireFn("./lib/kb.js");
const { parseConfig } = requireFn("./lib/config.js");
const Anthropic = requireFn("@anthropic-ai/sdk").default;

await run(async () => {
  const { opts } = parseArgs();
  const db = getDb();

  const { config } = parseConfig((await db.collection("config").doc("main").get()).data());
  const model = resolveModel(opts.model ?? config.aiModel);
  const threshold = opts.nguong !== undefined ? Number(opts.nguong) : config.confidenceThreshold;
  if (!(threshold >= 0 && threshold <= 1)) fail("--nguong phải từ 0 đến 1");

  const kbSnap = await db.collection(KB).where("status", "==", "approved").get();
  const items = kbSnap.docs
    .map((d) => toKbItem(d.id, d.data()))
    .filter(Boolean)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  if (!items.length) fail("Kho chưa có mục approved nào.");
  const approved = new Set(items.map((i) => i.slug));

  let tests = (await db.collection(TESTSET).get()).docs
    .map((d) => d.data())
    .filter((t) => typeof t.question === "string" && t.question.trim())
    .sort((a, b) => (a.stt ?? 0) - (b.stt ?? 0));
  if (opts["gioi-han"]) tests = tests.slice(0, Number(opts["gioi-han"]));
  if (!tests.length) fail("eval_testset trống. Chạy eval-import-testset trước.");

  console.log(`Model: ${model} | ngưỡng: ${threshold} | ${items.length} mục approved | ${tests.length} câu thử\n`);

  const client = new Anthropic({ maxRetries: 2 });
  const rows = [];
  let inTok = 0;
  let outTok = 0;
  const ms = [];
  for (const t of tests) {
    const sel = await selectItem(t.question, items, { client, model, timeoutMs: 30000 });
    inTok += sel.inputTokens;
    outTok += sel.outputTokens;
    ms.push(sel.ms);
    const expected = t.expected_slug || null;
    rows.push({
      stt: t.stt,
      hoi: t.question,
      mong_doi: expected ? (approved.has(expected) ? expected : `${expected} (chưa approved)`) : "(chuyển ca)",
      chon: sel.ok ? (sel.slug ?? "null") : `lỗi: ${sel.error}`,
      conf: sel.ok ? sel.confidence.toFixed(2) : "",
      ket_luan: judge(expected, sel, threshold, approved),
    });
    process.stdout.write(".");
  }
  console.log("\n");

  printTable(rows, [
    { key: "stt", label: "STT", max: 4 },
    { key: "hoi", label: "Câu hỏi", max: 40 },
    { key: "mong_doi", label: "Mong đợi", max: 30 },
    { key: "chon", label: "Bot chọn", max: 30 },
    { key: "conf", label: "Conf", max: 5 },
    { key: "ket_luan", label: "Kết luận", max: 30 },
  ]);

  const count = (v) => rows.filter((r) => r.ket_luan === v).length;
  console.log("\nTỔNG KẾT");
  for (const v of Object.values(VERDICTS)) console.log(`  ${v}: ${count(v)}`);
  const sorted = [...ms].sort((a, b) => a - b);
  console.log(`  Thời gian AI: trung vị ${sorted[Math.floor(sorted.length / 2)]} ms, lâu nhất ${sorted.at(-1)} ms`);
  const cost = estimateCost(model, inTok, outTok);
  console.log(`  Token: vào ${inTok}, ra ${outTok}`);
  console.log(
    cost === null
      ? "  Chi phí: chưa có bảng giá cho model này"
      : `  Chi phí ước tính: $${cost.toFixed(4)} (≈ $${((cost / tests.length) * 1000).toFixed(3)} / 1.000 câu)`,
  );
  if (count(VERDICTS.answeredWithoutKb) > 0) {
    console.log(`\n  CẢNH BÁO: có ${count(VERDICTS.answeredWithoutKb)} câu bot trả lời khi kho không có đáp án (tiêu chí C7).`);
  }
});
