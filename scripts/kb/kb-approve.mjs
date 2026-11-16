// Duyệt mục: node kb-approve.mjs <slug> [slug...]
// Chỉ duyệt mục có nội dung trả lời, ít nhất 2 cách hỏi và có nguồn.
import { getDb } from "./lib/db.mjs";
import { fail, parseArgs, run } from "./lib/cli.mjs";
import { setStatus } from "./lib/status.mjs";

await run(async () => {
  const { positional } = parseArgs();
  if (!positional.length) fail("Cách dùng: node kb-approve.mjs <slug> [slug...]");
  const res = await setStatus(getDb(), positional, "approved", "kb-approve");
  for (const r of res) console.log(`  ${r.slug}: ${r.result}`);
  console.log(`Đã duyệt ${res.filter((r) => r.changed).length}/${res.length} mục.`);
});
