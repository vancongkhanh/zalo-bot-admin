import { describe, expect, it } from "vitest";
import { logic } from "./load-logic.mjs";

const {
  validateItemForm, buildItemWrite, needsLiveConfirm, mergeQuestions, suggestSlug, itemToForm,
  settingsFromConfig, validateSettings, summarizeStats, lastNDays, monthKey, filterItems, estimateCost,
  parseLinks, approveProblems, BOT_DEFAULTS, validateImages, scaleSize, imageFileProblem, imageSendNote,
  diffContent, addQuestionsText, suggestPayload, stripImageTag, REASON_LABELS,
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
      images: [],
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
      version: 1, steps: [], images: [], hit_count: 0, last_hit_at: null,
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
      max_images_per_answer: "4",
      image_ai_enabled: false,
      image_summary_enabled: true,
      image_text_enabled: true,
      monthly_image_ai_limit: "300",
      image_quota_message: BOT_DEFAULTS.image_quota_message,
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
      max_images_per_answer: 4, image_ai_enabled: false, image_summary_enabled: true, image_text_enabled: true,
      monthly_image_ai_limit: 300,
      image_quota_message: BOT_DEFAULTS.image_quota_message,
      allowed_chat_ids: ["g1", "g2"], chat_labels: { g1: "Nhóm 1" },
    });
  });

  it("bước F: đọc và ghi bốn trường đọc ảnh", () => {
    const f = settingsFromConfig({
      image_ai_enabled: true, image_summary_enabled: false, monthly_image_ai_limit: 50, image_quota_message: "Gõ chữ nhé",
    });
    expect(f).toMatchObject({
      image_ai_enabled: true, image_summary_enabled: false, monthly_image_ai_limit: "50", image_quota_message: "Gõ chữ nhé",
    });
    expect(settingsFromConfig({ monthly_image_ai_limit: 20000 }).monthly_image_ai_limit).toBe("300");
    const { data } = validateSettings({ ...f, confidence_threshold: "0.7", handoff_message: "ok", chats: [] });
    expect(data).toMatchObject({
      image_ai_enabled: true, image_summary_enabled: false, monthly_image_ai_limit: 50, image_quota_message: "Gõ chữ nhé",
    });
  });

  it("bước F: bỏ tiền tố [Ảnh] khi dùng mẫu làm cách hỏi", () => {
    expect(stripImageTag("[Ảnh] lỗi ký số")).toBe("lỗi ký số");
    expect(stripImageTag("lỗi ký số")).toBe("lỗi ký số");
    expect(REASON_LABELS.image_quota).toBeTruthy();
    expect(REASON_LABELS.image_fetch_error).toBeTruthy();
  });

  it.each([
    [{ confidence_threshold: "1.5" }, "Ngưỡng"],
    [{ confidence_threshold: "" }, "Ngưỡng"],
    [{ handoff_message: "  " }, "trống"],
    [{ handoff_message: "x".repeat(1001) }, "1000"],
    [{ chats: [{ id: "g 1", label: "" }] }, "khoảng trắng"],
    [{ chats: [{ id: "g1", label: "" }, { id: "g1", label: "" }] }, "trùng"],
    [{ chats: [{ id: "", label: "Nhóm" }] }, "chưa có mã"],
    [{ max_images_per_answer: "11" }, "Số ảnh"],
    [{ max_images_per_answer: "-1" }, "Số ảnh"],
    [{ max_images_per_answer: "2.5" }, "Số ảnh"],
    [{ max_images_per_answer: "" }, "Số ảnh"],
    [{ monthly_image_ai_limit: "10001" }, "Hạn mức đọc ảnh"],
    [{ monthly_image_ai_limit: "1.5" }, "Hạn mức đọc ảnh"],
    [{ image_quota_message: " " }, "hết hạn mức đọc ảnh trống"],
    [{ image_quota_message: "x".repeat(501) }, "500"],
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
        { id: "2026-11-17", data: { questions: 2, answered: 1, handoff: 1, ai_errors: 1, image_questions: 1, item_hits: { b: 2 } } },
      ],
      ["2026-11-15", "2026-11-16", "2026-11-17"],
    );
    expect(s.totals).toEqual({ questions: 6, answered: 4, handoff: 2, ai_errors: 1, image_questions: 1 });
    expect(s.rows[1]).toEqual({ day: "2026-11-16", questions: 0, answered: 0, handoff: 0, ai_errors: 0, image_questions: 0 });
    expect(s.topItems).toEqual([{ slug: "b", count: 3 }, { slug: "a", count: 2 }]);
    expect(s.autoRate).toBeCloseTo(4 / 6);
    expect(summarizeStats([], ["2026-11-15"]).autoRate).toBeNull();
  });

  it("chi phí theo bảng giá", () => {
    expect(estimateCost("claude-haiku-5-5", 1_000_000, 100_000)).toBeCloseTo(0.15);
    expect(estimateCost("khac", 1, 1)).toBeNull();
  });
});

describe("Ảnh (bước E)", () => {
  const img = (i, over = {}) => ({
    url: `https://firebasestorage.googleapis.com/v0/b/x/o/kb_images%2Fky-so%2F${i}.jpg?alt=media&token=t`,
    path: `kb_images/ky-so/${i}.jpg`, caption: "", width: 1600, height: 900, bytes: 200000, ...over,
  });

  it("validateItemForm nhận ảnh đúng thư mục của mục, gọn chú thích", () => {
    const r = validateItemForm(form({ images: [img(1, { caption: "  Bước   đầu " }), img(2)] }));
    expect(r.errors).toEqual([]);
    expect(r.item.images).toEqual([img(1, { caption: "Bước đầu" }), img(2)]);
  });

  it("chặn quá 10 ảnh, chú thích quá 200 ký tự, ảnh của mục khác hoặc link không https", () => {
    const many = Array.from({ length: 11 }, (_, i) => img(i));
    expect(validateItemForm(form({ images: many })).errors.join()).toContain("Tối đa 10 ảnh");
    expect(validateItemForm(form({ images: [img(1, { caption: "c".repeat(201) })] })).errors.join()).toContain("200");
    expect(validateItemForm(form({ images: [img(1, { path: "kb_images/muc-khac/1.jpg" })] })).item).toBeNull();
    expect(validateItemForm(form({ images: [img(1, { url: "http://x/1.jpg" })] })).item).toBeNull();
    expect(validateImages(undefined, "ky-so")).toEqual({ images: [], errors: [] });
    const local = img(1, { url: "http://127.0.0.1:9199/v0/b/demo/o/x" });
    expect(validateItemForm(form({ images: [local] })).item).toBeNull();
    expect(validateItemForm(form({ images: [local] }), { localImageUrls: true }).item).not.toBeNull();
  });

  it("đổi, đảo thứ tự hoặc gỡ ảnh là đổi nội dung: version tăng, mục đã duyệt cần xác nhận (E9)", () => {
    const old = { ...validateItemForm(form({ status: "approved", images: [img(1), img(2)] })).item, version: 3 };
    const swapped = { ...old, images: [img(2), img(1)] };
    expect(buildItemWrite(old, swapped, "a@x.vn", "NOW")).toMatchObject({ images: [img(2), img(1)], version: 4 });
    expect(needsLiveConfirm(old, swapped)).toBe(true);
    expect(needsLiveConfirm(old, { ...old, images: [img(1)] })).toBe(true);
    expect(buildItemWrite(old, { ...old, images: [img(1), img(2, { caption: "Mới" })] }, "a@x.vn", "NOW").version).toBe(4);
  });

  it("mục cũ chưa có trường images coi như không có ảnh (không tính là thay đổi)", () => {
    const old = { ...validateItemForm(form()).item, version: 2 };
    delete old.images;
    expect(diffContent(old, { ...old, images: [] })).toEqual([]);
    expect(buildItemWrite(old, { ...old, images: [] }, "a@x.vn", "NOW")).toBeNull();
    expect(itemToForm("ky-so", old).images).toEqual([]);
  });

  it("scaleSize: cạnh dài tối đa 1600, không phóng to", () => {
    expect(scaleSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(scaleSize(1080, 2400)).toEqual({ width: 720, height: 1600 });
    expect(scaleSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("imageFileProblem: chặn tệp không phải ảnh và ảnh gốc > 10 MB", () => {
    expect(imageFileProblem({ type: "image/png", size: 5 * 1048576 })).toBeNull();
    expect(imageFileProblem({ type: "application/pdf", size: 10 })).toContain("Không phải");
    expect(imageFileProblem({ type: "image/jpeg", size: 11 * 1048576 })).toContain("10 MB");
  });

  it("imageSendNote giải thích ảnh nào gửi, ảnh nào thành link", () => {
    expect(imageSendNote(3, 4)).toContain("3 ảnh");
    expect(imageSendNote(6, 4)).toBe("Bot gửi 4 ảnh đầu, 2 ảnh sau thành link trong tin chữ.");
    expect(imageSendNote(2, 0)).toContain("tắt gửi ảnh");
    expect(imageSendNote(0, 4)).toBe("");
  });

  it("Cài đặt đọc max_images_per_answer; giá trị sai dùng mặc định", () => {
    expect(settingsFromConfig({ max_images_per_answer: 0 }).max_images_per_answer).toBe("0");
    expect(settingsFromConfig({ max_images_per_answer: 12 }).max_images_per_answer).toBe("4");
  });
});


describe("AI đề xuất cách hỏi (trang)", () => {
  it("addQuestionsText thêm câu mới, bỏ câu trùng kể cả khác dấu", () => {
    expect(addQuestionsText("ký số thế nào\n\ncài chữ ký số", ["ky so the nao", "  ký số bị lỗi ", ""]))
      .toBe("ký số thế nào\ncài chữ ký số\nký số bị lỗi");
    expect(addQuestionsText("", ["a"])).toBe("a");
  });
  it("suggestPayload lấy tiêu đề, nhóm, trả lời, các cách hỏi đã có", () => {
    expect(suggestPayload(form({ title: " Ký   số ", questions: "a\na\nb" }))).toEqual({
      title: "Ký số", topic: "Chữ ký", answer: "Vào mục Ký số.", questions: ["a", "b"],
    });
  });
});

describe("bước G: lịch sử hỗ trợ", () => {
  const {
    historyClauses, historySince, isHistoryRecord, historyStatus, historySummary, filterHistory, splitPii, maskPii,
    hasPii, formatBytes, SILENT_REASONS,
  } = logic;

  it("Tất cả = các kết quả có gọi tên bot, cộng tin bot không trả lời; không có no_mention", () => {
    const all = historyClauses("all");
    expect(all).toEqual([["outcome", ["answered", "replied", "handoff", "error"]], ["ignore_reason", SILENT_REASONS]]);
    expect(JSON.stringify(all)).not.toContain("no_mention");
    expect(historyClauses("answered")).toEqual([["outcome", ["answered", "replied"]]]);
    expect(historyClauses("error")).toEqual([["outcome", ["error"]], ["send_ok", [false]]]);
  });

  it("chỉ nhận tin gọi tên bot", () => {
    expect(isHistoryRecord({ outcome: "answered" })).toBe(true);
    expect(isHistoryRecord({ outcome: "ignored", ignore_reason: "image_ai_disabled" })).toBe(true);
    expect(isHistoryRecord({ outcome: "ignored", ignore_reason: "no_mention" })).toBe(false);
    expect(isHistoryRecord({ outcome: "ignored", ignore_reason: "not_group:PRIVATE" })).toBe(false);
    expect(isHistoryRecord(null)).toBe(false);
  });

  it("mốc thời gian theo 0 giờ Việt Nam", () => {
    const now = new Date("2026-11-17T20:00:00Z"); // 03:00 ngày 18/11 giờ Việt Nam
    expect(historySince("today", now).toISOString()).toBe("2026-11-17T17:00:00.000Z");
    expect(historySince("7", now).toISOString()).toBe("2026-11-11T17:00:00.000Z");
    expect(historySince("90", now).toISOString()).toBe("2026-08-20T17:00:00.000Z");
  });

  it("nhãn kết quả và tóm tắt; gửi lỗi tính là lỗi", () => {
    expect(historyStatus({ outcome: "answered" }).key).toBe("answered");
    expect(historyStatus({ outcome: "replied" }).key).toBe("answered");
    expect(historyStatus({ outcome: "handoff" }).key).toBe("handoff");
    expect(historyStatus({ outcome: "answered", send_ok: false }).key).toBe("error");
    expect(historyStatus({ outcome: "ignored", ignore_reason: "quota" }).key).toBe("silent");
    expect(historySummary([
      { outcome: "answered", source: "image" }, { outcome: "handoff" }, { outcome: "error" },
      { outcome: "ignored", ignore_reason: "quota" },
    ])).toEqual({ total: 4, answered: 1, handoff: 1, error: 1, silent: 1, image: 1 });
  });

  it("ẩn đoạn ⟦…⟧, số điện thoại, CCCD, email; thiếu dấu đóng thì ẩn hết phần sau", () => {
    expect(maskPii("Hồ sơ ⟦H12.34-0001⟧ của ⟦Nguyễn Văn A⟧ lỗi")).toBe("Hồ sơ [đã ẩn] của [đã ẩn] lỗi");
    expect(maskPii("gọi 0912 345 678, +84912345678 hoặc 0912.345.678")).toBe("gọi [đã ẩn], [đã ẩn] hoặc [đã ẩn]");
    expect(maskPii("CCCD 001234567890 và mail a.b@x.gov.vn")).toBe("CCCD [đã ẩn] và mail [đã ẩn]");
    expect(maskPii("Tên ⟦Trần Thị B")).toBe("Tên [đã ẩn]");
    expect(splitPii("a ⟦X⟧ b")).toEqual([{ text: "a ", pii: false }, { text: "X", pii: true }, { text: " b", pii: false }]);
  });

  it("không ẩn nhầm số ngắn, mã lỗi, ngày tháng", () => {
    for (const t of ["Lỗi 404", "mã ZXQ-77", "ngày 17/11/2026", "phiên bản 2.10.3", "123456789"]) {
      expect(maskPii(t)).toBe(t);
      expect(hasPii(t)).toBe(false);
    }
    expect(hasPii(null, undefined, "")).toBe(false);
    expect(hasPii("x", "⟦A⟧")).toBe(true);
  });

  it("ô tìm không dò được thông tin đã ẩn và chữ đọc từ ảnh", () => {
    const rows = [
      { display_name: "Lan", question: "ký số lỗi, gọi 0912345678", reply_text: "Vào mục Ký số", image_text: "⟦Nguyễn Văn A⟧" },
      { display_name: "Minh", question: "đổi mật khẩu" },
    ];
    expect(filterHistory(rows, "ky so")).toHaveLength(1);
    expect(filterHistory(rows, "0912345678")).toHaveLength(0);
    expect(filterHistory(rows, "Nguyễn Văn A")).toHaveLength(0);
    expect(filterHistory(rows, "minh")).toHaveLength(1);
    expect(filterHistory(rows, "  ")).toHaveLength(2);
  });

  it("bộ lọc khớp đúng nhãn: tin gửi lỗi chỉ ở Lỗi", () => {
    const bad = { outcome: "answered", send_ok: false };
    expect(logic.matchesKind(bad, "answered")).toBe(false);
    expect(logic.matchesKind(bad, "error")).toBe(true);
    expect(logic.matchesKind(bad, "all")).toBe(true);
    expect(logic.matchesKind({ outcome: "ignored", ignore_reason: "no_mention" }, "all")).toBe(false);
  });

  it("dung lượng ảnh", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
    expect(formatBytes(null)).toBe("");
  });

  it("Cài đặt: image_text_enabled mặc định bật, ghi được", () => {
    expect(settingsFromConfig({}).image_text_enabled).toBe(true);
    expect(settingsFromConfig({ image_text_enabled: false }).image_text_enabled).toBe(false);
    const { data } = validateSettings({ ...settingsFromConfig({}), image_text_enabled: false });
    expect(data.image_text_enabled).toBe(false);
  });
});

describe("bước G2: ảnh gốc từ link Zalo", () => {
  it("chỉ nhận link https, tối đa 2000 ký tự", () => {
    expect(logic.safePhotoUrl("https://x.example/a.jpg")).toBe("https://x.example/a.jpg");
    expect(logic.safePhotoUrl("http://x.example/a.jpg")).toBeNull();
    expect(logic.safePhotoUrl("javascript:alert(1)")).toBeNull();
    expect(logic.safePhotoUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(logic.safePhotoUrl("https://x.example/" + "a".repeat(2000))).toBeNull();
    expect(logic.safePhotoUrl(null)).toBeNull();
  });

  it("nhãn nút mở", () => {
    expect(logic.revealLabel(true, true)).toBe("Xem ảnh và thông tin cá nhân");
    expect(logic.revealLabel(true, false)).toBe("Xem ảnh");
    expect(logic.revealLabel(false, true)).toBe("Hiện thông tin cá nhân");
    expect(logic.revealLabel(false, false)).toBeNull();
  });
});

describe("quy chi phí AI ra VND", () => {
  it("làm tròn đến đồng; thiếu số liệu thì null", () => {
    expect(logic.usdToVnd(0.007, 26350)).toBe(184);
    expect(logic.usdToVnd(1.5, 26350.5)).toBe(39526);
    expect(logic.usdToVnd(0, 26350)).toBe(0);
    expect(logic.usdToVnd(null, 26350)).toBeNull();
    expect(logic.usdToVnd(1, 0)).toBeNull();
    expect(logic.usdToVnd(1, undefined)).toBeNull();
  });

  it("ghi nguồn tỷ giá", () => {
    const note = logic.fxNote({ rate: 26350, source: "Vietcombank", source_time: "11/17/2026 11:43:14 AM" });
    expect(note).toContain("Vietcombank");
    expect(note).toMatch(/26\.350 đ/);
    expect(note).toContain("cập nhật 11:43 17/11/2026");
    expect(logic.vcbTime("11/17/2026 1:05:00 PM")).toBe("13:05 17/11/2026");
    expect(logic.vcbTime("11/17/2026 12:10:00 AM")).toBe("00:10 17/11/2026");
    expect(logic.vcbTime("lạ")).toBe("lạ");
    expect(logic.fxNote({ rate: 26350, source: "Vietcombank", stale: true })).toContain("tỷ giá cũ");
    expect(logic.fxNote(null)).toBe("");
  });
});

describe("biểu đồ tròn mục được dùng nhiều nhất", () => {
  it("summarizeStats tính tổng lượt mọi mục, kể cả ngoài top 10", () => {
    const hits = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`m${i}`, 1]));
    const s = logic.summarizeStats([{ id: "2026-11-15", data: { item_hits: hits } }], ["2026-11-15"]);
    expect(s.topItems).toHaveLength(10);
    expect(s.itemTotal).toBe(12);
  });

  it("tối đa 5 mục có tên, phần còn lại gộp 'khác'; tổng phần = 1", () => {
    const top = [8, 5, 3, 2, 1, 1].map((count, i) => ({ slug: `m${i}`, count }));
    const sl = logic.pieSlices(top, 25);
    expect(sl).toHaveLength(6);
    expect(sl.slice(0, 5).map((x) => x.slug)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    expect(sl[5]).toMatchObject({ slug: null, count: 6 });
    expect(sl.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1);
  });

  it("ít mục thì không có 'khác'; không có lượt thì rỗng", () => {
    expect(logic.pieSlices([{ slug: "a", count: 3 }], 3)).toEqual([{ slug: "a", count: 3, share: 1 }]);
    expect(logic.pieSlices([], 0)).toEqual([]);
  });

  it("pieArc: cả vòng và nửa vòng", () => {
    expect(logic.pieArc(0, 1, 10)).toContain("A10 10 0 1 1 0 10");
    expect(logic.pieArc(0, 0.5, 10)).toBe("M0 0L0 -10A10 10 0 0 1 0 10Z");
  });
});

describe("phân trang danh sách", () => {
  const rows = Array.from({ length: 37 }, (_, i) => i + 1);

  it("số dòng mỗi trang chỉ nhận 10, 20, 50", () => {
    expect(logic.PAGE_SIZES).toEqual([10, 20, 50]);
    expect(logic.pageSize("20")).toBe(20);
    expect(logic.pageSize(50)).toBe(50);
    expect(logic.pageSize(null)).toBe(10);
    expect(logic.pageSize("15")).toBe(10);
  });

  it("cắt trang và kéo trang về khoảng hợp lệ", () => {
    expect(logic.pageSlice(rows, 1, 10)).toMatchObject({ page: 1, pages: 4, total: 37, from: 1, to: 10 });
    const last = logic.pageSlice(rows, 4, 10);
    expect(last.items).toEqual([31, 32, 33, 34, 35, 36, 37]);
    expect(last).toMatchObject({ from: 31, to: 37 });
    expect(logic.pageSlice(rows, 9, 20)).toMatchObject({ page: 2, from: 21, to: 37 });
    expect(logic.pageSlice(rows, 0, 50)).toMatchObject({ page: 1, pages: 1, to: 37 });
    expect(logic.pageSlice([], 3, 10)).toMatchObject({ page: 1, pages: 1, total: 0, from: 0, to: 0, items: [] });
  });

  it("nút số trang gọn, có dấu …", () => {
    expect(logic.pageNumbers(1, 1)).toEqual([1]);
    expect(logic.pageNumbers(2, 4)).toEqual([1, 2, 3, 4]);
    expect(logic.pageNumbers(1, 10)).toEqual([1, 2, null, 10]);
    expect(logic.pageNumbers(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(logic.pageNumbers(3, 10)).toEqual([1, 2, 3, 4, null, 10]);
  });
});
