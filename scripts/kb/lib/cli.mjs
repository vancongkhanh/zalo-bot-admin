// Tiện ích dòng lệnh dùng chung.
import { existsSync } from "node:fs";
import { explainAuthError } from "./db.mjs";

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set();
  const opts = {};
  const positional = [];
  for (const a of argv) {
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) opts[a.slice(2, eq)] = a.slice(eq + 1);
      else flags.add(a.slice(2));
    } else positional.push(a);
  }
  return { flags, opts, positional };
}

export function requireFile(path, usage) {
  if (!path) fail(`Thiếu tệp. Cách dùng: ${usage}`);
  if (!existsSync(path)) fail(`Không thấy tệp: ${path}`);
}

export function fail(msg) {
  console.error(`Lỗi: ${msg}`);
  process.exit(1);
}

function cut(v, n) {
  const a = Array.from(String(v ?? "").replace(/\s+/g, " "));
  return a.length > n ? a.slice(0, n - 1).join("") + "…" : a.join("");
}

function pad(s, n) {
  return s + " ".repeat(Math.max(0, n - Array.from(s).length));
}

/** In bảng chữ đơn giản, cắt ô dài. columns: [{key, label, max}] */
export function printTable(rows, columns) {
  if (!rows.length) {
    console.log("  (không có)");
    return;
  }
  const widths = columns.map((c) => {
    const max = c.max ?? 40;
    const cells = rows.map((r) => Array.from(cut(r[c.key], max)).length);
    return Math.min(max, Math.max(Array.from(c.label).length, ...cells));
  });
  console.log("  " + columns.map((c, i) => pad(c.label, widths[i])).join("  "));
  console.log("  " + widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) {
    console.log("  " + columns.map((c, i) => pad(cut(r[c.key], c.max ?? 40), widths[i])).join("  "));
  }
}

export async function run(main) {
  // Thư viện Firestore có thể ném lỗi đăng nhập ngoài luồng await: bắt cả loại này.
  const onAsyncError = (err) => fail(explainAuthError(err));
  process.on("unhandledRejection", onAsyncError);
  process.on("uncaughtException", onAsyncError);
  try {
    await main();
  } catch (err) {
    fail(explainAuthError(err));
  }
}
