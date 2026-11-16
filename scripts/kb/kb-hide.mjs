// Ẩn mục (bot không dùng nữa; mục vẫn còn, không bị xóa): node kb-hide.mjs <slug> [slug...]
import { getDb } from "./lib/db.mjs";
import { fail, parseArgs, run } from "./lib/cli.mjs";
import { setStatus } from "./lib/status.mjs";

await run(async () => {
  const { positional } = parseArgs();
  if (!positional.length) fail("Cách dùng: node kb-hide.mjs <slug> [slug...]");
  const res = await setStatus(getDb(), positional, "hidden", "kb-hide");
  for (const r of res) console.log(`  ${r.slug}: ${r.result}`);
  console.log(`Đã ẩn ${res.filter((r) => r.changed).length}/${res.length} mục.`);
});
