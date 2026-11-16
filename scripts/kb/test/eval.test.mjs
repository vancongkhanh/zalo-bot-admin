import { describe, expect, it } from "vitest";
import { estimateCost, judge, resolveModel, VERDICTS } from "../lib/eval.mjs";

const approved = new Set(["ky-so", "loi-thieu-quyen"]);
const ok = (slug, confidence) => ({ ok: true, slug, confidence });

describe("judge", () => {
  it.each([
    ["ky-so", ok("ky-so", 0.9), VERDICTS.correct],
    ["ky-so", ok("loi-thieu-quyen", 0.9), VERDICTS.wrongItem],
    ["ky-so", ok("ky-so", 0.5), VERDICTS.extraHandoff],
    ["ky-so", ok(null, 0.9), VERDICTS.extraHandoff],
    [null, ok(null, 0.9), VERDICTS.correctHandoff],
    [null, ok("ky-so", 0.4), VERDICTS.correctHandoff],
    [null, ok("ky-so", 0.9), VERDICTS.answeredWithoutKb],
    ["ky-so", { ok: false, error: "timeout" }, VERDICTS.error],
    [null, { ok: false, error: "timeout" }, VERDICTS.correctHandoff],
    // Mục mong đợi chưa approved: bot không thể trả lời, nên coi như kho không có.
    ["muc-nhap", ok("ky-so", 0.9), VERDICTS.answeredWithoutKb],
  ])("mong đợi %s, chọn %o → %s", (expected, sel, verdict) => {
    expect(judge(expected, sel, 0.7, approved)).toBe(verdict);
  });
});

describe("model và chi phí", () => {
  it("bí danh", () => {
    expect(resolveModel("haiku")).toBe("claude-haiku-5-5");
    expect(resolveModel("sonnet")).toBe("claude-sonnet-5-5");
    expect(resolveModel("claude-x")).toBe("claude-x");
  });
  it("ước tính chi phí", () => {
    expect(estimateCost("claude-haiku-5-5", 1_000_000, 100_000)).toBeCloseTo(0.15);
    expect(estimateCost("khong-ro", 1, 1)).toBeNull();
  });
});
