/**
 * OA-0b: tệp xác thực quyền sở hữu URL của Zalo (docs/giao-claude-code-oa-0b.md).
 *
 * Nội dung nhúng sẵn trong mã (không phải bí mật): lúc chạy không đọc hệ thống file,
 * nên không có đường cho path traversal. Bản gốc ở docs/<tên tệp>; test so từng byte.
 * Thêm tệp mới: chép tệp vào docs/ rồi thêm một mục vào VERIFIER_FILES.
 */

export const VERIFIER_FILES: Readonly<Record<string, string>> = Object.freeze({
  "zalo_verifierHkI_18tD4Xn7wyS6aUbHBM30WdgCjbaiDZCn.html":
    "<!DOCTYPE html>\n<html lang=\"en\">\n\n<head>\n    <meta property=\"zalo-platform-site-verification\" content=\"HkI_18tD4Xn7wyS6aUbHBM30WdgCjbaiDZCn\" />\n</head>\n\n<body>\nThere Is No Limit To What You Can Accomplish Using Zalo!\n</body>\n\n</html>",
});

export const VERIFIER_PREFIX = "/zalo_verifier";
/** Tiền tố tên hàm, phòng khi runtime không bỏ nó khỏi req.path. */
const FUNCTION_PREFIX = "/zaloOaWebhook";
const MAX_LOGGED_NAME = 100;

/**
 * Đối chiếu nguyên văn (không giải mã %xx, không chuẩn hóa, phân biệt hoa/thường).
 * Chỉ khớp "/<tên>" hoặc "/zaloOaWebhook/<tên>" với tên nằm trong VERIFIER_FILES.
 */
export function matchVerifier(path: unknown): { name: string; content: string } | null {
  if (typeof path !== "string") return null;
  const rest = path.startsWith(FUNCTION_PREFIX + "/") ? path.slice(FUNCTION_PREFIX.length) : path;
  if (!rest.startsWith("/")) return null;
  const name = rest.slice(1);
  if (!Object.prototype.hasOwnProperty.call(VERIFIER_FILES, name)) return null;
  return { name, content: VERIFIER_FILES[name] };
}

/**
 * Đường dẫn trông giống tệp xác thực (chỉ để quyết định ghi log zalo_verifier_hit;
 * không phân biệt hoa/thường). Việc khớp tệp vẫn do matchVerifier đối chiếu nguyên văn.
 */
export function looksLikeVerifier(path: unknown): boolean {
  return typeof path === "string" && path.toLowerCase().includes(VERIFIER_PREFIX);
}

/** Tên ghi log: phần sau dấu "/" cuối, cắt ngắn. Không bao giờ là nội dung tệp. */
export function loggedName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).slice(0, MAX_LOGGED_NAME);
}
