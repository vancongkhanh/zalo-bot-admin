import { createHash, timingSafeEqual } from "node:crypto";

/**
 * So sánh hai chuỗi trong thời gian không đổi.
 * Băm SHA-256 trước để hai bên luôn cùng độ dài (timingSafeEqual yêu cầu vậy),
 * nên thời gian so sánh không lộ độ dài hay vị trí ký tự sai.
 */
export function safeEqual(provided: string | undefined | null, expected: string): boolean {
  if (typeof provided !== "string" || provided.length === 0 || !expected) return false;
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** Lấy giá trị header (Express đưa tên header về chữ thường; có thể là mảng). */
export function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

export const SECRET_HEADER = "x-bot-api-secret-token";
