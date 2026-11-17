/**
 * Tỷ giá USD → VND cho ô "Chi phí AI ước tính" của trang quản trị.
 *
 * Nguồn: bảng tỷ giá công khai của Vietcombank (XML). Trình duyệt không đọc trực tiếp được
 * (Vietcombank chỉ cho phép trang của họ), nên hàm đọc giúp và lưu đệm 6 giờ ở
 * `fx_rates/usd_vnd` (Vietcombank yêu cầu không gọi quá 1 lần mỗi 5 phút).
 * Dùng giá **bán** USD: giá ngân hàng tính khi trả tiền bằng USD (ví dụ thẻ thanh toán Anthropic).
 */
export const VCB_XML_URL = "https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx";
export const FX_CACHE_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const MAX_XML_BYTES = 200_000;

export interface FxRate {
  rate: number;
  source: "Vietcombank";
  rate_type: "sell";
  /** Giờ cập nhật Vietcombank ghi trong bảng (chuỗi gốc, giờ Việt Nam). */
  source_time: string | null;
  /** Mili giây (epoch) lúc hàm đọc bảng. */
  fetched_at: number;
}

const toNumber = (s: string) => Number(s.replace(/,/g, ""));

/** Lấy giá bán USD từ XML Vietcombank. Sai mẫu hoặc số vô lý thì null. */
export function parseVcbUsd(xml: string): { sell: number; sourceTime: string | null } | null {
  const tag = xml.match(/<Exrate\b[^>]*\bCurrencyCode="USD"[^>]*\/?>/)?.[0];
  if (!tag) return null;
  const sellText = tag.match(/\bSell="([\d,.]+)"/)?.[1];
  if (!sellText) return null;
  const sell = toNumber(sellText);
  // Chặn số vô lý (sai định dạng, đổi đơn vị): USD/VND nằm rất xa hai mốc này.
  if (!Number.isFinite(sell) || sell < 10_000 || sell > 100_000) return null;
  const sourceTime = xml.match(/<DateTime>([^<]{1,40})<\/DateTime>/)?.[1]?.trim() ?? null;
  return { sell, sourceTime };
}

export interface FxDeps {
  isAdmin(uid: string): Promise<boolean>;
  readCache(): Promise<FxRate | null>;
  writeCache(rate: FxRate): Promise<void>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  logger: { warn(m: string, d?: Record<string, unknown>): void };
}

export type FxResult =
  | { ok: true; rate: FxRate; stale: boolean }
  | { ok: false; code: "unauthenticated" | "permission-denied" | "unavailable"; message: string };

async function fetchXml(fetchImpl: typeof fetch): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(VCB_XML_URL, { signal: ctrl.signal, redirect: "error" });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const text = await res.text();
    if (text.length > MAX_XML_BYTES) throw new Error("too_large");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export async function handleFxRate(uid: string | undefined, deps: FxDeps): Promise<FxResult> {
  if (!uid) return { ok: false, code: "unauthenticated", message: "Cần đăng nhập." };
  if (!(await deps.isAdmin(uid))) return { ok: false, code: "permission-denied", message: "Không có quyền." };
  const now = (deps.now ?? Date.now)();
  const cached = await deps.readCache();
  if (cached && now - cached.fetched_at < FX_CACHE_MS) return { ok: true, rate: cached, stale: false };
  try {
    const parsed = parseVcbUsd(await fetchXml(deps.fetchImpl ?? fetch));
    if (!parsed) throw new Error("bad_format");
    const rate: FxRate = {
      rate: parsed.sell, source: "Vietcombank", rate_type: "sell", source_time: parsed.sourceTime, fetched_at: now,
    };
    await deps.writeCache(rate);
    return { ok: true, rate, stale: false };
  } catch (e) {
    const error = e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : "unknown";
    deps.logger.warn("Không đọc được tỷ giá Vietcombank", { error });
    if (cached) return { ok: true, rate: cached, stale: true };
    return { ok: false, code: "unavailable", message: "Chưa đọc được tỷ giá Vietcombank, thử lại sau." };
  }
}
