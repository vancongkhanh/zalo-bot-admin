import { describe, expect, it } from "vitest";
import {
  charLength, cleanText, detectPlatform, diffContent, parseLinks, splitKeywords, splitLines, validateRow, validateTestRow,
} from "../lib/validate.mjs";

const good = {
  slug: "dang-nhap-quen-mat-khau",
  tieu_de: "Quên mật khẩu đăng nhập",
  nhom: "Tài khoản",
  cach_hoi: "quên mật khẩu\r\nkhông đăng nhập được\nquen mat khau",
  tra_loi: "Bước 1: bấm Quên mật khẩu.\nBước 2: nhập email.",
  link: "Video hướng dẫn | https://www.youtube.com/watch?v=abc\nhttps://drive.google.com/file/d/xyz",
  tu_khoa: "mật khẩu, đăng nhập, ",
  nguon: "HDSD v2, trang 12",
  trang_thai: "approved",
};

describe("chuẩn hóa ô", () => {
  it("cleanText: \\r\\n và _x000D_ về \\n, NFC, cắt hai đầu", () => {
    expect(cleanText("  a_x000D_\r\nb  ")).toBe("a\nb");
    expect(cleanText("Đảng".normalize("NFD"))).toBe("Đảng");
    expect(cleanText(null)).toBe("");
  });
  it("splitLines bỏ dòng trống, dòng trùng, gộp khoảng trắng", () => {
    expect(splitLines("a\n\n  b  c \na\n")).toEqual(["a", "b c"]);
  });
  it("splitKeywords tách theo dấu phẩy", () => {
    expect(splitKeywords("x, y ,,x")).toEqual(["x", "y"]);
  });
  it("charLength đếm theo ký tự Unicode", () => {
    expect(charLength("😀".repeat(3))).toBe(3);
  });
});

describe("link", () => {
  it("nhận 'Nhãn | url' và url trơn; đặt nhãn theo nền tảng", () => {
    const { links, errors } = parseLinks(good.link);
    expect(errors).toEqual([]);
    expect(links).toEqual([
      { label: "Video hướng dẫn", url: "https://www.youtube.com/watch?v=abc", platform: "youtube" },
      { label: "Drive", url: "https://drive.google.com/file/d/xyz", platform: "drive" },
    ]);
  });
  it("nhận diện nền tảng", () => {
    expect(detectPlatform("https://youtu.be/x")).toBe("youtube");
    expect(detectPlatform("https://m.facebook.com/x")).toBe("facebook");
    expect(detectPlatform("https://fb.watch/x")).toBe("facebook");
    expect(detectPlatform("https://docs.google.com/x")).toBe("drive");
    expect(detectPlatform("https://example.gov.vn/x")).toBe("other");
  });
  it("từ chối http, sai định dạng", () => {
    expect(parseLinks("Video | http://youtube.com/x").errors.length).toBe(1);
    expect(parseLinks("Video | youtube.com/x").errors.length).toBe(1);
    expect(parseLinks("chỉ có chữ").errors.length).toBe(1);
  });
});

describe("validateRow", () => {
  it("dòng hợp lệ → mục đầy đủ", () => {
    const { item, errors, warnings } = validateRow(good);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(item).toMatchObject({
      slug: "dang-nhap-quen-mat-khau",
      title: "Quên mật khẩu đăng nhập",
      topic: "Tài khoản",
      questions: ["quên mật khẩu", "không đăng nhập được", "quen mat khau"],
      answer: "Bước 1: bấm Quên mật khẩu.\nBước 2: nhập email.",
      keywords: ["mật khẩu", "đăng nhập"],
      source: "HDSD v2, trang 12",
      status: "approved",
    });
  });
  it("trang_thai trống → draft", () => {
    expect(validateRow({ ...good, trang_thai: "" }).item.status).toBe("draft");
  });
  it("slug trống, sai định dạng → từ chối", () => {
    expect(validateRow({ ...good, slug: "" }).errors).toContain("slug trống");
    expect(validateRow({ ...good, slug: "Dang Nhap" }).item).toBeNull();
    expect(validateRow({ ...good, slug: "đăng-nhập" }).item).toBeNull();
    expect(validateRow({ ...good, slug: "a--b" }).item).toBeNull();
  });
  it("tra_loi > 1.500 ký tự → từ chối, báo độ dài; đúng 1.500 → nhận", () => {
    const r = validateRow({ ...good, tra_loi: "a".repeat(1501) });
    expect(r.item).toBeNull();
    expect(r.errors.join()).toContain("1501");
    expect(validateRow({ ...good, tra_loi: "ă".repeat(1500) }).item).not.toBeNull();
  });
  it("cach_hoi < 2: cảnh báo nếu draft, từ chối nếu approved", () => {
    const d = validateRow({ ...good, cach_hoi: "một cách", trang_thai: "draft" });
    expect(d.item).not.toBeNull();
    expect(d.warnings.length).toBe(1);
    expect(validateRow({ ...good, cach_hoi: "một cách" }).item).toBeNull();
  });
  it("nguon trống: cảnh báo nếu draft, từ chối nếu approved", () => {
    expect(validateRow({ ...good, nguon: "", trang_thai: "draft" }).warnings).toContain("nguon trống");
    expect(validateRow({ ...good, nguon: "" }).item).toBeNull();
  });
  it("link sai → từ chối cả dòng", () => {
    expect(validateRow({ ...good, link: "Video | http://x.com" }).item).toBeNull();
  });
  it("trang_thai lạ → từ chối; hidden được chấp nhận", () => {
    expect(validateRow({ ...good, trang_thai: "ok" }).item).toBeNull();
    expect(validateRow({ ...good, trang_thai: "hidden" }).item.status).toBe("hidden");
  });
  it("tieu_de hoặc tra_loi trống → từ chối", () => {
    expect(validateRow({ ...good, tieu_de: "" }).item).toBeNull();
    expect(validateRow({ ...good, tra_loi: "  " }).item).toBeNull();
  });
});

describe("diffContent", () => {
  it("chỉ ra trường nội dung khác nhau, bỏ qua trường khác", () => {
    const a = validateRow(good).item;
    expect(diffContent(a, { ...a, hit_count: 5, status: "draft" })).toEqual([]);
    expect(diffContent(a, { ...a, answer: "khác", questions: ["x"] })).toEqual(["questions", "answer"]);
  });
});

describe("validateTestRow", () => {
  it("câu hợp lệ, slug trống = mong đợi chuyển ca", () => {
    expect(validateTestRow({ stt: "3", cau_hoi_that: "làm sao  đổi mk", slug_dung: "" }).item).toEqual({
      id: "t-03", stt: 3, question: "làm sao đổi mk", expected_slug: null,
    });
  });
  it("bỏ qua dòng ví dụ và dòng trống", () => {
    expect(validateTestRow({ stt: "1", cau_hoi_that: "(VÍ DỤ - xóa) câu hỏi", slug_dung: "vi-du-1" }).skip).toBe("ví dụ");
    expect(validateTestRow({ stt: "", cau_hoi_that: "", slug_dung: "" }).skip).toBe("trống");
  });
  it("stt sai, slug sai định dạng → lỗi", () => {
    expect(validateTestRow({ stt: "x", cau_hoi_that: "a", slug_dung: "" }).errors.length).toBe(1);
    expect(validateTestRow({ stt: "1", cau_hoi_that: "a", slug_dung: "Sai Slug" }).errors.length).toBe(1);
  });
});
