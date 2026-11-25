import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildReplyMessage, quoteText, ReplyAsk } from "../src/replyMessage";

interface Case {
  name: string;
  answer: string;
  asks: (Omit<ReplyAsk, "askedAtMs"> & { askedAt: string | null })[];
  expected: string;
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/reply-message.json", import.meta.url), "utf8"),
) as { cases: Case[] };

const toAsks = (c: Case): ReplyAsk[] =>
  c.asks.map(({ askedAt, ...a }) => ({ ...a, askedAtMs: askedAt ? Date.parse(askedAt) : null }));

describe("buildReplyMessage: bộ mẫu chung với trang quản trị", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(buildReplyMessage(toAsks(c), c.answer)).toBe(c.expected);
    });
  }
});

describe("quoteText", () => {
  it("cắt 200 ký tự Unicode và thêm …", () => {
    const q = quoteText({ displayName: "A", question: "ệ".repeat(250), askedAtMs: null });
    expect(Array.from(q)).toHaveLength(201);
    expect(q.endsWith("ệ…")).toBe(true);
  });
  it("đúng 200 ký tự thì không cắt", () => {
    expect(quoteText({ displayName: "A", question: "a".repeat(200), askedAtMs: null })).toBe("a".repeat(200));
  });
  it("câu chữ rỗng → (không có nội dung)", () => {
    expect(quoteText({ displayName: "A", question: "  ", askedAtMs: null })).toBe("(không có nội dung)");
  });
});
