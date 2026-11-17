import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import type { AiClient } from "../src/selector";
import {
  buildSuggestRequest, handleSuggest, MAX_SUGGESTIONS, parseSuggestInput, parseSuggestions, SuggestDeps,
} from "../src/suggest";

const input = { title: "Đổi mật khẩu", topic: "Tài khoản", answer: "Vào Cài đặt > Mật khẩu.", questions: ["quên mật khẩu"] };

function reply(text: string, stop = "end_turn") {
  return {
    id: "msg_fake", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: stop, stop_sequence: null,
    content: [{ type: "text", text, citations: null }],
    usage: { input_tokens: 400, output_tokens: 80 },
  } as unknown as Anthropic.Message;
}

function deps(over: Partial<SuggestDeps> = {}, impl = async () => reply('{"questions":["làm sao đổi mật khẩu","doi mk o dau"]}')) {
  const create = vi.fn(impl);
  const usage: unknown[] = [];
  const d: SuggestDeps = {
    isAdmin: async (uid) => uid === "admin-1",
    getClient: () => ({ messages: { create } }) as unknown as AiClient,
    getModel: async () => ({ model: "claude-haiku-5-5", timeoutMs: 20000 }),
    recordUsage: async (c) => void usage.push(c),
    logger: { warn: vi.fn(), error: vi.fn() },
    ...over,
  };
  return { d, create, usage };
}

describe("đề xuất cách hỏi: đầu vào", () => {
  it("cần tiêu đề; gọn khoảng trắng, giới hạn độ dài", () => {
    expect(parseSuggestInput({ title: "  " })).toContain("tiêu đề");
    expect(parseSuggestInput(null)).toContain("tiêu đề");
    const r = parseSuggestInput({ title: " Đổi   mật khẩu ", answer: "x".repeat(2000), questions: ["a", "", 5, "b"] });
    expect(r).toMatchObject({ title: "Đổi mật khẩu", topic: "", questions: ["a", "b"] });
    expect(typeof r !== "string" && Array.from(r.answer).length).toBe(1500);
  });

  it("yêu cầu gửi AI: tiêu đề, nhóm, trả lời, cách hỏi đã có trong thẻ; đầu ra JSON schema", () => {
    const req = buildSuggestRequest(input, "claude-haiku-5-5");
    const content = req.messages[0].content as string;
    expect(content).toContain("<tieu_de>Đổi mật khẩu</tieu_de>");
    expect(content).toContain("<tra_loi>");
    expect(content).toContain("- quên mật khẩu");
    expect(req.output_config?.format).toMatchObject({ type: "json_schema" });
  });
});

describe("đề xuất cách hỏi: kiểm tra đầu ra", () => {
  it("bỏ câu trùng câu đã có hoặc tiêu đề (không xét dấu), câu rỗng, quá dài; tối đa 8", () => {
    const many = Array.from({ length: 12 }, (_, i) => `cách ${i}`);
    const text = JSON.stringify({ questions: ["Quen mat khau", "đổi mật khẩu", " ", "x".repeat(201), "đổi mk  ở đâu", "doi mk o dau", 7, ...many] });
    const out = parseSuggestions(text, input) as string[];
    expect(out[0]).toBe("đổi mk ở đâu");
    expect(out).not.toContain("Quen mat khau");
    expect(out).not.toContain("doi mk o dau");
    expect(out).toHaveLength(MAX_SUGGESTIONS);
  });
  it("JSON sai → lỗi", () => {
    expect(parseSuggestions("abc", input)).toBe("invalid_json");
    expect(parseSuggestions('{"x":1}', input)).toBe("invalid_shape");
  });
});

describe("đề xuất cách hỏi: quyền và gọi AI", () => {
  it("chưa đăng nhập hoặc không có trong admins → từ chối, không gọi AI", async () => {
    const { d, create } = deps();
    expect(await handleSuggest(undefined, { title: "A" }, d)).toMatchObject({ ok: false, code: "unauthenticated" });
    expect(await handleSuggest("nguoi-ngoai", { title: "A" }, d)).toMatchObject({ ok: false, code: "permission-denied" });
    expect(await handleSuggest("admin-1", { title: "" }, d)).toMatchObject({ ok: false, code: "invalid-argument" });
    expect(create).not.toHaveBeenCalled();
  });

  it("admin → gợi ý đã lọc, ghi bộ đếm token", async () => {
    const { d, usage } = deps();
    expect(await handleSuggest("admin-1", input, d)).toEqual({ ok: true, questions: ["làm sao đổi mật khẩu", "doi mk o dau"] });
    expect(usage).toEqual([{ ok: true, inputTokens: 400, outputTokens: 80 }]);
  });

  it("AI lỗi hoặc hết giờ → thông báo chung, vẫn ghi bộ đếm lỗi", async () => {
    const { d, usage } = deps({}, async () => {
      throw new Anthropic.APIConnectionTimeoutError();
    });
    expect(await handleSuggest("admin-1", input, d)).toMatchObject({ ok: false, code: "unavailable" });
    expect(usage).toEqual([{ ok: false, inputTokens: 0, outputTokens: 0 }]);
    expect(d.logger.error).toHaveBeenCalledWith("Lỗi đề xuất cách hỏi", { error: "timeout" });
  });

  it("AI dừng giữa chừng (max_tokens) → lỗi", async () => {
    const { d } = deps({}, async () => reply('{"questions":["a"', "max_tokens"));
    expect(await handleSuggest("admin-1", input, d)).toMatchObject({ ok: false, code: "unavailable" });
  });
});
