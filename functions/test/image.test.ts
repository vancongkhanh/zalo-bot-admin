import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, parseConfig } from "../src/config";
import { fetchImage, FetchImpl, sniffImageType } from "../src/imageFetch";
import type { KbItem } from "../src/kb";
import { buildImageRequest, buildRequest, MAX_IMAGE_TEXT_CHARS, MAX_SUMMARY_CHARS, parseImageText, parseSummary } from "../src/selector";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]);

function respond(body: Uint8Array | string, init: { status?: number; headers?: Record<string, string> } = {}): FetchImpl {
  return vi.fn(async () => new Response(body, { status: init.status ?? 200, headers: init.headers }));
}

describe("bước F: tải ảnh người dùng", () => {
  it("nhận dạng định dạng theo byte đầu", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(JPG)).toBe("image/jpeg");
    expect(sniffImageType(new TextEncoder().encode("GIF89a"))).toBe("image/gif");
    expect(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("<html>"))).toBeNull();
  });

  it("ảnh hợp lệ → base64, kiểu theo nội dung (kể cả khi Content-Type sai)", async () => {
    const r = await fetchImage("https://zalo.example/a", {
      fetchImpl: respond(PNG, { headers: { "content-type": "application/octet-stream" } }),
    });
    expect(r).toMatchObject({ ok: true, mediaType: "image/png", bytes: PNG.length, data: Buffer.from(PNG).toString("base64") });
  });

  it("chỉ nhận https, link hợp lệ", async () => {
    const f = respond(PNG);
    expect(await fetchImage("http://zalo.example/a", { fetchImpl: f })).toMatchObject({ ok: false, error: "not_https" });
    expect(await fetchImage("không phải link", { fetchImpl: f })).toMatchObject({ ok: false, error: "invalid_url" });
    expect(f).not.toHaveBeenCalled();
  });

  it("lỗi HTTP, quá dung lượng, rỗng, không phải ảnh → mã lỗi ngắn", async () => {
    expect(await fetchImage("https://z/a", { fetchImpl: respond("x", { status: 403 }) })).toMatchObject({ error: "http_403" });
    expect(
      await fetchImage("https://z/a", { fetchImpl: respond(PNG, { headers: { "content-length": "999999999" } }) }),
    ).toMatchObject({ error: "too_large" });
    expect(await fetchImage("https://z/a", { fetchImpl: respond(PNG), maxBytes: 5 })).toMatchObject({ error: "too_large" });
    expect(await fetchImage("https://z/a", { fetchImpl: respond(new Uint8Array()) })).toMatchObject({ error: "empty" });
    expect(
      await fetchImage("https://z/a", { fetchImpl: respond("<html>", { headers: { "content-type": "text/html; charset=utf-8" } }) }),
    ).toMatchObject({ error: "unsupported_type:text/html" });
  });

  it("quá thời gian → timeout; lỗi mạng → network", async () => {
    const hang: FetchImpl = (_u, init) =>
      new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    expect(await fetchImage("https://z/a", { fetchImpl: hang, timeoutMs: 20 })).toMatchObject({ ok: false, error: "timeout" });
    const broken: FetchImpl = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await fetchImage("https://z/a", { fetchImpl: broken })).toMatchObject({ ok: false, error: "network:TypeError" });
  });
});

const ITEMS: KbItem[] = [{ slug: "ky-so", title: "Ký số", questions: ["ký số"], answer: "x", links: [] }];

describe("bước F: yêu cầu AI cho ảnh", () => {
  it("system giống hệt câu hỏi chữ (dùng chung cache); ảnh base64 trước, chữ sau", () => {
    const req = buildImageRequest("lỗi gì", { data: "QUJD", mediaType: "image/jpeg" }, ITEMS, "claude-haiku-5-5", true);
    expect(req.system).toEqual(buildRequest("x", ITEMS, "claude-haiku-5-5").system);
    const content = req.messages[0].content as { type: string; text?: string }[];
    expect(content.map((b) => b.type)).toEqual(["image", "text"]);
    expect(content[1].text).toContain("không phải chỉ dẫn");
    expect(content[1].text).toContain("Không chép tên người");
    expect(content[1].text).toContain("<cau_hoi>\nlỗi gì\n</cau_hoi>");
    expect(JSON.stringify(req.output_config)).toContain('"required":["slug","confidence","mo_ta"]');
  });

  it("tắt mô tả → không có mo_ta trong lời nhắc và lược đồ", () => {
    const req = buildImageRequest("", { data: "QUJD", mediaType: "image/png" }, ITEMS, "claude-haiku-5-5", false);
    expect(JSON.stringify(req)).not.toContain("mo_ta");
  });

  it("mô tả: gọn một dòng, tối đa 200 ký tự; sai kiểu hoặc rỗng → null", () => {
    expect(parseSummary('{"mo_ta":"  Màn hình\\n ký số  "}')).toBe("Màn hình ký số");
    expect(Array.from(parseSummary(JSON.stringify({ mo_ta: "á".repeat(300) }))!).length).toBe(MAX_SUMMARY_CHARS);
    expect(parseSummary('{"mo_ta":5}')).toBeNull();
    expect(parseSummary('{"mo_ta":"  "}')).toBeNull();
    expect(parseSummary("không phải json")).toBeNull();
  });
});

describe("bước F: cấu hình", () => {
  it("mặc định: tắt đọc ảnh, hạn mức 300, có mô tả", () => {
    expect(DEFAULT_CONFIG).toMatchObject({ imageAiEnabled: false, monthlyImageAiLimit: 300, imageSummaryEnabled: true });
  });

  it("đọc đúng các trường hợp lệ, bỏ trường sai kèm cảnh báo", () => {
    const ok = parseConfig({
      image_ai_enabled: true,
      monthly_image_ai_limit: 50,
      image_quota_message: "  Gõ chữ giúp nhé ",
      image_summary_enabled: false,
    });
    expect(ok.config).toMatchObject({
      imageAiEnabled: true,
      monthlyImageAiLimit: 50,
      imageQuotaMessage: "Gõ chữ giúp nhé",
      imageSummaryEnabled: false,
    });
    expect(ok.warnings).toEqual([]);
    const bad = parseConfig({
      image_ai_enabled: "true",
      monthly_image_ai_limit: 1.5,
      image_quota_message: "x".repeat(501),
      image_summary_enabled: 1,
    });
    expect(bad.config).toMatchObject({
      imageAiEnabled: false,
      monthlyImageAiLimit: 300,
      imageQuotaMessage: DEFAULT_CONFIG.imageQuotaMessage,
      imageSummaryEnabled: true,
    });
    expect(bad.warnings).toHaveLength(4);
  });
});

describe("bước G: chữ đọc được trên ảnh", () => {
  it("bật → lời nhắc dặn bọc thông tin cá nhân bằng ⟦…⟧, lược đồ bắt buộc noi_dung_anh, max_tokens 2048", () => {
    const req = buildImageRequest("", { data: "QUJD", mediaType: "image/png" }, ITEMS, "claude-haiku-5-5", true, true);
    const content = req.messages[0].content as { type: string; text?: string }[];
    expect(content[1].text).toContain("noi_dung_anh");
    expect(content[1].text).toContain("⟦Nguyễn Văn A⟧");
    expect(JSON.stringify(req.output_config)).toContain('"required":["slug","confidence","mo_ta","noi_dung_anh"]');
    expect(req.max_tokens).toBe(2048);
    expect(req.system).toEqual(buildRequest("x", ITEMS, "claude-haiku-5-5").system);
  });

  it("giữ xuống dòng, gọn khoảng trắng, gộp dòng trống, bỏ ký tự điều khiển", () => {
    const raw = "  Ký số \r\n\r\n\r\nLỗi:\t không\u0007 tìm thấy  \n";
    expect(parseImageText(JSON.stringify({ noi_dung_anh: raw }))).toBe("Ký số\n\nLỗi: không tìm thấy");
  });

  it("tối đa 1000 ký tự; cắt giữa ⟦…⟧ thì đóng lại", () => {
    const long = parseImageText(JSON.stringify({ noi_dung_anh: "á".repeat(1500) }))!;
    expect(Array.from(long).length).toBe(MAX_IMAGE_TEXT_CHARS);
    const cut = parseImageText(JSON.stringify({ noi_dung_anh: "x".repeat(995) + "⟦Nguyễn Văn A⟧" }))!;
    expect(cut.endsWith("⟦Nguy⟧")).toBe(true);
  });

  it("sai kiểu, rỗng, không phải JSON → null", () => {
    expect(parseImageText('{"noi_dung_anh":5}')).toBeNull();
    expect(parseImageText('{"noi_dung_anh":" \\n "}')).toBeNull();
    expect(parseImageText("không phải json")).toBeNull();
  });

  it("cấu hình image_text_enabled: mặc định true, sai kiểu thì cảnh báo", () => {
    expect(DEFAULT_CONFIG.imageTextEnabled).toBe(true);
    expect(parseConfig({ image_text_enabled: false }).config.imageTextEnabled).toBe(false);
    const bad = parseConfig({ image_text_enabled: "no" });
    expect(bad.config.imageTextEnabled).toBe(true);
    expect(bad.warnings).toEqual(["image_text_enabled không phải boolean"]);
  });
});
