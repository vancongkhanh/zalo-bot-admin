import { describe, expect, it } from "vitest";
import { headerValue, safeEqual } from "../src/security";

describe("safeEqual", () => {
  it("đúng khi hai chuỗi giống hệt", () => {
    expect(safeEqual("secret-12345", "secret-12345")).toBe(true);
  });
  it("sai khi khác nội dung, khác độ dài, khác hoa thường", () => {
    expect(safeEqual("secret-12346", "secret-12345")).toBe(false);
    expect(safeEqual("secret-1234", "secret-12345")).toBe(false);
    expect(safeEqual("SECRET-12345", "secret-12345")).toBe(false);
  });
  it("sai khi thiếu hoặc rỗng", () => {
    expect(safeEqual(undefined, "secret-12345")).toBe(false);
    expect(safeEqual(null, "secret-12345")).toBe(false);
    expect(safeEqual("", "secret-12345")).toBe(false);
  });
  it("sai khi secret cấu hình rỗng (không bao giờ cho qua)", () => {
    expect(safeEqual("", "")).toBe(false);
    expect(safeEqual("abc", "")).toBe(false);
  });
});

describe("headerValue", () => {
  it("đọc header chữ thường, lấy phần tử đầu nếu là mảng", () => {
    expect(headerValue({ "x-bot-api-secret-token": "a" }, "X-Bot-Api-Secret-Token")).toBe("a");
    expect(headerValue({ "x-bot-api-secret-token": ["b", "c"] }, "x-bot-api-secret-token")).toBe("b");
    expect(headerValue({}, "x-bot-api-secret-token")).toBeUndefined();
  });
});
