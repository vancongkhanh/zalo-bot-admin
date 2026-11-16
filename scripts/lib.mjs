// Thư viện chung cho các script. Không in token hay secret ra màn hình.
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..");

/** Nạp lớp gọi API Zalo đã biên dịch (chạy `npm --prefix functions run build` trước). */
export function loadZaloClient() {
  const libPath = join(ROOT, "functions", "lib", "zaloClient.js");
  if (!existsSync(libPath)) {
    fail("Chưa biên dịch. Chạy trước: npm --prefix functions run build");
  }
  const require = createRequire(import.meta.url);
  return require(libPath);
}

/** Địa chỉ hàm mặc định, suy từ .firebaserc. */
export function defaultWebhookUrl() {
  try {
    const rc = JSON.parse(readFileSync(join(ROOT, ".firebaserc"), "utf8"));
    const project = rc?.projects?.default;
    if (project) return `https://asia-southeast1-${project}.cloudfunctions.net/zaloWebhook`;
  } catch {
    /* không có .firebaserc */
  }
  return undefined;
}

export function fail(message) {
  console.error(`Lỗi: ${message}`);
  process.exit(1);
}

/** Hỏi hiện chữ, có giá trị mặc định (Enter để chấp nhận). */
export async function prompt(question, defaultValue) {
  if (!process.stdin.isTTY) fail(`Không có terminal để hỏi "${question}"`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  rl.close();
  return answer || defaultValue || "";
}

/** Hỏi ẩn ký tự (không hiện, không lưu vào lịch sử lệnh). */
export function promptHidden(question) {
  if (!process.stdin.isTTY) fail(`Không có terminal để hỏi "${question}"; hãy đặt biến môi trường`);
  process.stdout.write(`${question} (ẩn ký tự): `);
  const stdin = process.stdin;
  return new Promise((resolve) => {
    let value = "";
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write(`\n`);
          resolve(value.trim());
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

/**
 * Dấu vân tay của bí mật: độ dài + 8 ký tự đầu của SHA-256.
 * Dùng để so sánh hai lần nhập mà không lộ giá trị.
 */
export function fingerprint(value) {
  const hash = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8);
  return `dài ${Array.from(value).length} ký tự, sha256 bắt đầu ${hash}`;
}

/** Ký tự điều khiển (ví dụ ^V khi Ctrl+V không dán được trong cmd). */
function controlChars(value) {
  return [...value].filter((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
}

/** Lấy bí mật từ biến môi trường; nếu không có thì hỏi ẩn. In dấu vân tay để đối chiếu. */
export async function getSecret(envName, label) {
  const fromEnv = process.env[envName]?.trim();
  const v = fromEnv || (await promptHidden(label));
  if (!v) fail(`Thiếu ${envName}`);
  const bad = controlChars(v);
  if (bad.length) {
    const codes = bad.map((c) => "0x" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(", ");
    fail(
      `${envName} chứa ký tự điều khiển (${codes}). Có thể phím Ctrl+V không dán được trong cửa sổ này; ` +
        `hãy dán bằng chuột phải, hoặc dùng Windows Terminal/PowerShell.`,
    );
  }
  console.log(`${envName}${fromEnv ? " (từ biến môi trường)" : ""}: ${fingerprint(v)}`);
  return v;
}

/** Thay mọi bí mật trong chuỗi bằng ***. */
export function redact(text, secrets) {
  let out = text;
  for (const s of secrets) {
    if (!s) continue;
    out = out.split(s).join("***");
    const enc = encodeURIComponent(s);
    if (enc !== s) out = out.split(enc).join("***");
  }
  return out;
}

/** In kết quả; che token/secret phòng khi Zalo trả lại chúng trong phản hồi. */
export function printResult(action, result, secrets = []) {
  if (result.ok) {
    console.log(`${action}: thành công.`);
    console.log("Phản hồi:", redact(JSON.stringify(result.result) ?? "", secrets));
  } else {
    console.error(`${action}: thất bại.`);
    console.error(redact(JSON.stringify(result.error, null, 2), secrets));
    process.exitCode = 1;
  }
}
