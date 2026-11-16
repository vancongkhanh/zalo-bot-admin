import { describe, expect, it } from "vitest";
import { stripMention } from "../src/mention";

const BOT = "Bot TTHC Đảng";

describe("stripMention", () => {
  it("cắt @tên bot ở đầu câu", () => {
    expect(stripMention("@Bot TTHC Đảng xin chào", BOT)).toEqual({ text: "xin chào", hadMention: true });
  });

  it("không có khoảng trắng sau tên bot vẫn cắt (khi theo sau là dấu câu)", () => {
    expect(stripMention("@Bot TTHC Đảng, cho hỏi", BOT)).toEqual({ text: ", cho hỏi", hadMention: true });
  });

  it("khoảng trắng thừa sau @ và giữa các từ", () => {
    expect(stripMention("@  Bot   TTHC  Đảng    cho hỏi  ", BOT)).toEqual({ text: "cho hỏi", hadMention: true });
  });

  it("không phân biệt hoa thường, kể cả Đ/đ", () => {
    expect(stripMention("@bot tthc đảng hello", BOT)).toEqual({ text: "hello", hadMention: true });
    expect(stripMention("@BOT TTHC ĐẢNG hello", BOT)).toEqual({ text: "hello", hadMention: true });
  });

  it("chỉ có @ không kèm nội dung → chuỗi rỗng", () => {
    expect(stripMention("@Bot TTHC Đảng", BOT)).toEqual({ text: "", hadMention: true });
    expect(stripMention("   @Bot TTHC Đảng   ", BOT)).toEqual({ text: "", hadMention: true });
  });

  it("@ ở giữa câu và nhiều lần", () => {
    expect(stripMention("cho hỏi @Bot TTHC Đảng về thủ tục @Bot TTHC Đảng", BOT)).toEqual({
      text: "cho hỏi về thủ tục",
      hadMention: true,
    });
  });

  it("chữ có dấu dạng NFD vẫn khớp", () => {
    const nfd = "@Bot TTHC Đảng hỏi".normalize("NFD");
    expect(stripMention(nfd, BOT)).toEqual({ text: "hỏi", hadMention: true });
  });

  it("không có @tên bot → hadMention=false, giữ nguyên nội dung", () => {
    expect(stripMention("xin chào mọi người", BOT)).toEqual({ text: "xin chào mọi người", hadMention: false });
    expect(stripMention("@Người Khác hỏi", BOT)).toEqual({ text: "@Người Khác hỏi", hadMention: false });
  });

  it("không cắt khi tên bot dính liền chữ phía sau", () => {
    expect(stripMention("@Bot TTHC Đảngviên", BOT).hadMention).toBe(false);
  });

  it("giữ xuống dòng trong câu hỏi", () => {
    expect(stripMention("@Bot TTHC Đảng dòng 1\n  dòng 2", BOT)).toEqual({ text: "dòng 1\ndòng 2", hadMention: true });
  });

  it("ký tự đặc biệt trong tên bot được thoát đúng", () => {
    expect(stripMention("@Bot (v1.0)? hỏi", "Bot (v1.0)?")).toEqual({ text: "hỏi", hadMention: true });
  });
});
