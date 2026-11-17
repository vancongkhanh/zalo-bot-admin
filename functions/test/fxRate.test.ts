import { describe, expect, it, vi } from "vitest";
import { FX_CACHE_MS, FxRate, handleFxRate, parseVcbUsd, VCB_XML_URL } from "../src/fxRate";

// Bảng giả theo đúng mẫu XML công khai của Vietcombank (số liệu bịa).
const XML = `<!--For reference only. Only one request every 5 minutes!-->
<ExrateList>
  <DateTime>11/17/2026 11:43:14 AM</DateTime>
  <Exrate CurrencyCode="AUD" CurrencyName="AUSTRALIAN DOLLAR   " Buy="16,917.04" Transfer="17,087.92" Sell="17,635.75" />
  <Exrate CurrencyCode="USD" CurrencyName="US DOLLAR           " Buy="25,980.00" Transfer="26,010.00" Sell="26,350.00" />
  <Source>Joint Stock Commercial Bank for Foreign Trade of Vietnam - Vietcombank</Source>
</ExrateList>`;

const NOW = 1_800_000_000_000;
const logger = { warn: vi.fn() };
const okFetch = vi.fn(async () => new Response(XML, { status: 200 })) as unknown as typeof fetch;

function deps(o: Partial<Parameters<typeof handleFxRate>[1]> = {}) {
  const writes: FxRate[] = [];
  return {
    writes,
    d: {
      isAdmin: async () => true,
      readCache: async () => null,
      writeCache: async (r: FxRate) => void writes.push(r),
      fetchImpl: okFetch,
      now: () => NOW,
      logger,
      ...o,
    },
  };
}

describe("tỷ giá Vietcombank", () => {
  it("đọc giá bán USD và giờ cập nhật", () => {
    expect(parseVcbUsd(XML)).toEqual({ sell: 26350, sourceTime: "11/17/2026 11:43:14 AM" });
  });

  it("sai mẫu hoặc số vô lý → null", () => {
    expect(parseVcbUsd("<html>bảo trì</html>")).toBeNull();
    expect(parseVcbUsd(XML.replace('Sell="26,350.00"', 'Sell="-"'))).toBeNull();
    expect(parseVcbUsd(XML.replace('Sell="26,350.00"', 'Sell="26.35"'))).toBeNull();
    expect(parseVcbUsd(XML.replace('Sell="26,350.00"', 'Sell="2,635,000.00"'))).toBeNull();
  });

  it("chưa đăng nhập / không phải admin → từ chối, không gọi Vietcombank", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    expect(await handleFxRate(undefined, deps({ fetchImpl: f }).d)).toMatchObject({ ok: false, code: "unauthenticated" });
    expect(await handleFxRate("u", deps({ fetchImpl: f, isAdmin: async () => false }).d)).toMatchObject({
      ok: false, code: "permission-denied",
    });
    expect(f).not.toHaveBeenCalled();
  });

  it("chưa có đệm → đọc Vietcombank, lưu đệm", async () => {
    const { d, writes } = deps();
    const r = await handleFxRate("u", d);
    expect(r).toMatchObject({ ok: true, stale: false, rate: { rate: 26350, source: "Vietcombank", rate_type: "sell" } });
    expect(writes).toHaveLength(1);
    expect((okFetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBe(VCB_XML_URL);
  });

  it("đệm còn hạn (< 6 giờ) → không gọi Vietcombank", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    const cached: FxRate = { rate: 26000, source: "Vietcombank", rate_type: "sell", source_time: null, fetched_at: NOW - 1000 };
    const r = await handleFxRate("u", deps({ fetchImpl: f, readCache: async () => cached }).d);
    expect(r).toMatchObject({ ok: true, stale: false, rate: { rate: 26000 } });
    expect(f).not.toHaveBeenCalled();
  });

  it("đệm hết hạn mà Vietcombank lỗi → trả đệm cũ, đánh dấu stale", async () => {
    const cached: FxRate = {
      rate: 26000, source: "Vietcombank", rate_type: "sell", source_time: null, fetched_at: NOW - FX_CACHE_MS - 1,
    };
    const bad = vi.fn(async () => new Response("lỗi", { status: 503 })) as unknown as typeof fetch;
    const r = await handleFxRate("u", deps({ fetchImpl: bad, readCache: async () => cached }).d);
    expect(r).toMatchObject({ ok: true, stale: true, rate: { rate: 26000 } });
    expect(logger.warn).toHaveBeenCalledWith("Không đọc được tỷ giá Vietcombank", { error: "http_503" });
  });

  it("không có đệm mà Vietcombank sai mẫu → unavailable", async () => {
    const bad = vi.fn(async () => new Response("<html/>", { status: 200 })) as unknown as typeof fetch;
    expect(await handleFxRate("u", deps({ fetchImpl: bad }).d)).toMatchObject({ ok: false, code: "unavailable" });
  });
});
