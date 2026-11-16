// Nạp phần hàm thuần (giữa LOGIC-START và LOGIC-END) của index.html để kiểm thử,
// vì trang là một tệp HTML đơn, không có bước build.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const start = html.indexOf("/* LOGIC-START");
const end = html.indexOf("/* LOGIC-END */");
if (start < 0 || end < 0) throw new Error("Không thấy LOGIC-START / LOGIC-END trong index.html");
const code = html.slice(start, end);
const names = [...code.matchAll(/^(?:function|const)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
const file = join(mkdtempSync(join(tmpdir(), "admin-logic-")), "logic.mjs");
writeFileSync(file, `${code}\nexport { ${names.join(", ")} };\n`);

export const logic = await import(pathToFileURL(file).href);
