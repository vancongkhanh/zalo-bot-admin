/**
 * Bước F: tải ảnh người dùng gửi từ `photo_url` của Zalo để AI đọc (spec F, quyết định 4).
 *
 * Ảnh chỉ nằm trong bộ nhớ hàm. Không lưu, không ghi link hay nội dung ảnh vào log:
 * lỗi chỉ trả mã ngắn (mã HTTP, kiểu nội dung, dung lượng).
 */

export const IMAGE_FETCH_TIMEOUT_MS = 10_000;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export type FetchedImage =
  | { ok: true; data: string; mediaType: ImageMediaType; bytes: number; ms: number }
  | { ok: false; error: string; ms: number };

export type FetchImpl = (url: string, init: { signal: AbortSignal; redirect: "follow" }) => Promise<Response>;

export interface FetchImageOptions {
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
  maxBytes?: number;
  now?: () => number;
}

/** Nhận dạng định dạng theo các byte đầu (không tin hoàn toàn vào Content-Type). */
export function sniffImageType(b: Uint8Array): ImageMediaType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** Đọc thân trả về, dừng ngay khi vượt `maxBytes`. */
async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array | "too_large"> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length > maxBytes ? "too_large" : buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return "too_large";
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export async function fetchImage(url: string, opts: FetchImageOptions = {}): Promise<FetchedImage> {
  const now = opts.now ?? Date.now;
  const start = now();
  const fail = (error: string): FetchedImage => ({ ok: false, error, ms: now() - start });
  const maxBytes = opts.maxBytes ?? MAX_IMAGE_BYTES;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail("invalid_url");
  }
  if (parsed.protocol !== "https:") return fail("not_https");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? IMAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await (opts.fetchImpl ?? (fetch as FetchImpl))(url, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) return fail(`http_${res.status}`);
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) return fail("too_large");
    const body = await readLimited(res, maxBytes);
    if (body === "too_large") return fail("too_large");
    if (body.length === 0) return fail("empty");
    const mediaType = sniffImageType(body);
    if (!mediaType) {
      const ct = (res.headers.get("content-type") ?? "unknown").split(";")[0].trim().slice(0, 40);
      return fail(`unsupported_type:${ct}`);
    }
    return { ok: true, data: Buffer.from(body).toString("base64"), mediaType, bytes: body.length, ms: now() - start };
  } catch (err) {
    if (controller.signal.aborted) return fail("timeout");
    return fail(err instanceof Error ? `network:${err.name}` : "network");
  } finally {
    clearTimeout(timer);
  }
}
