// Liệt kê kho: node kb-list.mjs [--trang-thai=draft|approved|hidden]
import { getDb, loadKb } from "./lib/db.mjs";
import { parseArgs, printTable, run } from "./lib/cli.mjs";
import { charLength } from "./lib/validate.mjs";

await run(async () => {
  const { opts } = parseArgs();
  const kb = await loadKb(getDb());
  const rows = [...kb.entries()]
    .map(([slug, d]) => ({
      slug,
      tieu_de: d.title,
      tt: d.status,
      dai: charLength(d.answer),
      hoi: (d.questions ?? []).length,
      v: d.version,
      hit: d.hit_count ?? 0,
    }))
    .filter((r) => !opts["trang-thai"] || r.tt === opts["trang-thai"])
    .sort((a, b) => a.slug.localeCompare(b.slug));
  printTable(rows, [
    { key: "slug", label: "slug", max: 36 },
    { key: "tieu_de", label: "Tiêu đề", max: 36 },
    { key: "tt", label: "Trạng thái", max: 10 },
    { key: "dai", label: "Độ dài", max: 6 },
    { key: "hoi", label: "Cách hỏi", max: 8 },
    { key: "v", label: "Bản", max: 4 },
    { key: "hit", label: "Dùng", max: 5 },
  ]);
  const by = {};
  for (const r of rows) by[r.tt] = (by[r.tt] ?? 0) + 1;
  const summary = Object.entries(by).map(([k, v]) => `${k} ${v}`).join(", ");
  console.log(`\nTổng ${rows.length} mục${summary ? ": " + summary : ""}`);
});
