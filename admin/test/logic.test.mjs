import { describe, expect, it } from "vitest";
import { logic } from "./load-logic.mjs";

const {
  validateItemForm, buildItemWrite, needsLiveConfirm, mergeQuestions, suggestSlug, itemToForm,
  settingsFromConfig, validateSettings, summarizeStats, lastNDays, monthKey, filterItems, estimateCost,
  parseLinks, approveProblems, BOT_DEFAULTS,
} = logic;

const form = (over = {}) => ({
  slug: "ky-so",
  title: "Ký số",
  topic: "Chữ ký",
  questions: "ký số thế nào\ncài chữ ký số",
  answer: "Vào mục Ký số.",
  links: "Video | https://youtu.be/abc",
  keywords: "ký số, usb",
  source: "HDSD trang 3",
  status: "draft",
  ...over,
});

describe("validateItemForm", () => {
  it("form hợp lệ → mục đúng định dạng kb_items", () => {
    const r = validateItemForm(form(), { isNew: true });
    expect(r.errors).toEqual([]);
    expect(r.item).toEqual({
      title: "Ký số",
      topic: "Chữ ký",
      questions: ["ký số thế nào", "cài chữ ký số"],
      answer: "Vào mục Ký số.",
      links: [{ label: "Video", url: "https://youtu.be/abc", platform: "youtube" }],
      keywords: ["ký số", "usb"],
      source: "HDSD trang 3",
      status: "draft",
    });
  });

  it("chặn nội dung trả lời quá 1.500 ký tự (đếm ký tự Unicode)", () => {
    expect(validateItemForm(form({ answer: "ữ".repeat(1500) })).item).not.toBeNull();
    const r = validateItemForm(form({ answer: "ữ".repeat(1501) }));
    expect(r.item).toBeNull();
    expect(r.errors.join()).toContain("1501");
  });

  it("link sai định dạng hoặc không HTTPS bị chặn", () => {
    for (const links of ["Video | http://youtu.be/a", "không phải link", "Nhãn | https://a b.com"]) {
      expect(validateItemForm(form({ links })).item).toBeNull();
    }
  });

  it("slug mới: sai định dạng hoặc trùng bị chặn; mục đang sửa không kiểm slug", () => {
    expect(validateItemForm(form({ slug: "Ký Số" }), { isNew: true }).item).toBeNull();
    expect(validateItemForm(form(), { isNew: true, existingSlugs: new Set(["ky-so"]) }).item).toBeNull();
    expect(validateItemForm(form({ slug: "" }), { isNew: false }).item).not.toBeNull();
  });

  it("duyệt cần ít nhất 2 cách hỏi và có nguồn; nháp chỉ cảnh báo", () => {
    const draft = validateItemForm(form({ questions: "một cách", source: "" }));
    expect(draft.item).not.toBeNull();
    expect(draft.warnings).toHaveLength(2);
    const approved = validateItemForm(form({ questions: "một cách", source: "", status: "approved" }));
    expect(approved.item).toBeNull();
    expect(approved.errors).toHaveLength(2);
  });

  it("bỏ dòng trống và dòng trùng trong cách hỏi", () => {
    expect(validateItemForm(form({ questions: "a  b\n\na b\nc" })).item.questions).toEqual(["a b", "c"]);
  });
});

describe("buildItemWrite", () => {
  const item = validateItemForm(form()).item;

  it("tạo mới: đủ trường như script kb-import, bộ đếm về 0", () => {
    const d = buildItemWrite(null, item, "a@x.vn", "NOW");
    expect(d).toMatchObject({
      version: 1, steps: [], image_urls: [], hit_count: 0, last_hit_at: null,
      created_at: "NOW", updated_at: "NOW", updated_by: "a@x.vn", approved_at: null, approved_by: null,
    });
    const a = buildItemWrite(null, { ...item, status: "approved" }, "a@x.vn", "NOW");
    expect(a).toMatchObject({ approved_at: "NOW", approved_by: "a@x.vn" });
  });

  it("sửa nội dung: chỉ ghi trường đổi, version tăng, không đụng hit_count", () => {
    const old = { ...item, version: 3, hit_count: 9 };
    const d = buildItemWrite(old, { ...item, answer: "Mới" }, "a@x.vn", "NOW");
    expect(d).toEqual({ answer: "Mới", version: 4, updated_at: "NOW", updated_by: "a@x.vn" });
  });

  it("chỉ đổi trạng thái: version giữ nguyên; duyệt thì ghi người duyệt", () => {
    const old = { ...item, version: 2 };
    expect(buildItemWrite(old, { ...item, status: "approved" }, "a@x.vn", "NOW")).toEqual({
      status: "approved", updated_at: "NOW", updated_by: "a@x.vn", approved_at: "NOW", approved_by: "a@x.vn",
    });
    expect(buildItemWrite({ ...old, status: "approved" }, { ...item, status: "hidden" }, "a@x.vn", "NOW")).toEqual({
      status: "hidden", updated_at: "NOW", updated_by: "a@x.vn",
    });
  });

  it("không đổi gì → null", () => {
    expect(buildItemWrite({ ...item, version: 1 }, item, "a@x.vn", "NOW")).toBeNull();
  });
});

describe("needsLiveConfirm", () => {
  const item = validateItemForm(form()).item;
  it.each([
    [null, "approved", true],
    [{ ...item, status: "draft" }, "approved", true],
    [{ ...item, status: "draft" }, "draft", false],
    [{ ...item, status: "approved" }, "hidden", false],
  ])("cũ %o → %s: %s", (old, status, want) => {
    expect(needsLiveConfirm(old, { ...item, status })).toBe(want);
  });
  it("sửa nội dung mục đã duyệt cần xác nhận; không đổi gì thì không", () => {
    const old = { ...item, status: "approved" };
    expect(needsLiveConfirm(old, { ...old, answer: "khác" })).toBe(true);
    expect(needsLiveConfirm(old, { ...old })).toBe(false);
  });
});

describe("tiện ích kho", () => {
  it("mergeQuestions bỏ câu trùng kể cả khác dấu, hoa thường", () => {
    expect(mergeQuestions(["Ký số thế nào"], ["ky so the nao", "Cài chữ ký", " Cài   chữ ký "])).toEqual([
      "Ký số thế nào",
      "Cài chữ ký",
    ]);
  });

  it("suggestSlug", () => {
    expect(suggestSlug("Đổi mật khẩu tài khoản?")).toBe("doi-mat-khau-tai-khoan");
    expect(suggestSlug("a ".repeat(100)).length).toBeLessThanOrEqual(60);
    expect(suggestSlug("!!!")).toBe("");
  });

  it("itemToForm rồi validateItemForm cho lại đúng mục", () => {
    const item = validateItemForm(form()).item;
    expect(validateItemForm(itemToForm("ky-so", item)).item).toEqual(item);
  });

  it("filterItems tìm không dấu, lọc trạng thái và nhóm", () => {
    const entries = [
      ["ky-so", { title: "Ký số", status: "approved", topic: "A", questions: ["cài usb token"] }],
      ["doi-mk", { title: "Đổi mật khẩu", status: "draft", topic: "B", questions: [] }],
    ];
    expect(filterItems(entries, { q: "usb" }).map(([s]) => s)).toEqual(["ky-so"]);
    expect(filterItems(entries, { q: "doi mat" }).map(([s]) => s)).toEqual(["doi-mk"]);
    expect(filterItems(entries, { status: "draft" }).map(([s]) => s)).toEqual(["doi-mk"]);
    expect(filterItems(entries, { topic: "A" }).map(([s]) => s)).toEqual(["ky-so"]);
  });

  it("parseLinks và approveProblems giống script", () => {
    expect(parseLinks("https://drive.google.com/x").links[0]).toEqual({
      label: "Drive", url: "https://drive.google.com/x", platform: "drive",
    });
    expect(approveProblems({ answer: "", questions: [], source: "" })).toHaveLength(3);
  });
});

describe("Cài đặt", () => {
  it("thiếu trường thì dùng mặc định của bot", () => {
    expect(settingsFromConfig({})).toEqual({
      ai_enabled: false,
      reply_enabled: true,
      confidence_threshold: "0.7",
      handoff_message: BOT_DEFAULTS.handoff_message,
      chats: [],
    });
  });

  it("đọc nhãn nhóm", () => {
    const f = settingsFromConfig({ allowed_chat_ids: ["g1", "g2"], chat_labels: { g1: "Nhóm thử" } });
    expect(f.chats).toEqual([{ id: "g1", label: "Nhóm thử" }, { id: "g2", label: "" }]);
  });

  it("dữ liệu ghi chỉ gồm các trường được phép", () => {
    const { data, errors } = validateSettings({
      ai_enabled: true, reply_enabled: true, confidence_threshold: "0,8", handoff_message: " Chờ nhé ",
      chats: [{ id: " g1 ", label: "Nhóm 1" }, { id: "g2", label: "" }, { id: "", label: "" }],
    });
    expect(errors).toEqual([]);
    expect(data).toEqual({
      ai_enabled: true, reply_enabled: true, confidence_threshold: 0.8, handoff_message: "Chờ nhé",
      allowed_chat_ids: ["g1", "g2"], chat_labels: { g1: "Nhóm 1" },
    });
  });

  it.each([
    [{ confidence_threshold: "1.5" }, "Ngưỡng"],
    [{ confidence_threshold: "" }, "Ngưỡng"],
    [{ handoff_message: "  " }, "trống"],
    [{ handoff_message: "x".repeat(1001) }, "1000"],
    [{ chats: [{ id: "g 1", label: "" }] }, "khoảng trắng"],
    [{ chats: [{ id: "g1", label: "" }, { id: "g1", label: "" }] }, "trùng"],
    [{ chats: [{ id: "", label: "Nhóm" }] }, "chưa có mã"],
  ])("lỗi: %o", (over, text) => {
    const base = { ai_enabled: false, reply_enabled: true, confidence_threshold: "0.7", handoff_message: "ok", chats: [] };
    const { data, errors } = validateSettings({ ...base, ...over });
    expect(data).toBeNull();
    expect(errors.join()).toContain(text);
  });
});

describe("Thống kê", () => {
  it("lastNDays theo giờ Việt Nam", () => {
    // 16/11 18:30 UTC = 17/11 01:30 giờ Việt Nam
    const now = new Date("2026-11-16T18:30:00Z");
    expect(lastNDays(3, now)).toEqual(["2026-11-15", "2026-11-16", "2026-11-17"]);
    expect(monthKey(new Date("2026-11-30T17:30:00Z"))).toBe("2026-12");
  });

  it("gộp số liệu, điền ngày trống bằng 0, xếp mục dùng nhiều", () => {
    const s = summarizeStats(
      [
        { id: "2026-11-15", data: { questions: 4, answered: 3, handoff: 1, item_hits: { a: 2, b: 1 } } },
        { id: "2026-11-17", data: { questions: 2, answered: 1, handoff: 1, ai_errors: 1, item_hits: { b: 2 } } },
      ],
      ["2026-11-15", "2026-11-16", "2026-11-17"],
    );
    expect(s.totals).toEqual({ questions: 6, answered: 4, handoff: 2, ai_errors: 1 });
    expect(s.rows[1]).toEqual({ day: "2026-11-16", questions: 0, answered: 0, handoff: 0, ai_errors: 0 });
    expect(s.topItems).toEqual([{ slug: "b", count: 3 }, { slug: "a", count: 2 }]);
    expect(s.autoRate).toBeCloseTo(4 / 6);
    expect(summarizeStats([], ["2026-11-15"]).autoRate).toBeNull();
  });

  it("chi phí theo bảng giá", () => {
    expect(estimateCost("claude-haiku-5-5", 1_000_000, 100_000)).toBeCloseTo(0.15);
    expect(estimateCost("khac", 1, 1)).toBeNull();
  });
});
