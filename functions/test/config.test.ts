import { describe, expect, it } from "vitest";
import { dayKey, DEFAULT_CONFIG, monthKey, parseConfig } from "../src/config";

describe("parseConfig", () => {
  it("không có tài liệu → mặc định kèm cảnh báo", () => {
    const { config, warnings } = parseConfig(undefined);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(warnings.length).toBe(1);
  });

  it("đọc đủ các trường, nhiều nhóm", () => {
    const { config, warnings } = parseConfig({
      allowed_chat_ids: ["zgr-a", " zgr-b ", "", 5],
      bot_mention_name: "Bot TTHC Đảng",
      monthly_message_limit: 3000,
      reply_enabled: false,
      log_raw_body: false,
    });
    expect(warnings).toEqual([]);
    expect(config).toEqual({
      ...DEFAULT_CONFIG,
      allowedChatIds: ["zgr-a", "zgr-b"],
      botMentionName: "Bot TTHC Đảng",
      monthlyMessageLimit: 3000,
      replyEnabled: false,
      logRawBody: false,
    });
  });

  it("chat_labels: giữ nhãn chuỗi không rỗng (đã cắt khoảng trắng); sai kiểu thì cảnh báo", () => {
    expect(DEFAULT_CONFIG.chatLabels).toEqual({});
    const { config } = parseConfig({ chat_labels: { "zgr-a": " Nhóm A ", "zgr-b": "", "zgr-c": 5 } });
    expect(config.chatLabels).toEqual({ "zgr-a": "Nhóm A" });
    const bad = parseConfig({ chat_labels: ["x"] });
    expect(bad.config.chatLabels).toEqual({});
    expect(bad.warnings).toEqual(["chat_labels không phải map"]);
  });

  it("sai kiểu → dùng mặc định và cảnh báo", () => {
    const { config, warnings } = parseConfig({ allowed_chat_ids: "zgr-a", reply_enabled: "true" });
    expect(config.allowedChatIds).toEqual([]);
    expect(config.replyEnabled).toBe(true);
    expect(warnings.length).toBe(2);
  });
});

describe("parseConfig: trường bước C", () => {
  it("mặc định: AI tắt, Haiku 5.5, ngưỡng 0,7, 6.000 lời gọi, 15 giây", () => {
    expect(DEFAULT_CONFIG).toMatchObject({
      aiEnabled: false,
      aiModel: "claude-haiku-5-5",
      confidenceThreshold: 0.7,
      monthlyAiCallLimit: 6000,
      aiTimeoutMs: 15000,
    });
  });

  it("đọc giá trị hợp lệ", () => {
    const { config, warnings } = parseConfig({
      ai_enabled: true,
      ai_model: "claude-sonnet-5-5",
      confidence_threshold: 0.8,
      monthly_ai_call_limit: 100,
      handoff_message: "  Chờ chuyên viên.  ",
      ai_timeout_ms: 5000,
    });
    expect(warnings).toEqual([]);
    expect(config).toMatchObject({
      aiEnabled: true,
      aiModel: "claude-sonnet-5-5",
      confidenceThreshold: 0.8,
      monthlyAiCallLimit: 100,
      handoffMessage: "Chờ chuyên viên.",
      aiTimeoutMs: 5000,
    });
  });

  it("giá trị sai → giữ mặc định, mỗi trường một cảnh báo; AI vẫn tắt", () => {
    const { config, warnings } = parseConfig({
      ai_enabled: "true",
      ai_model: "gpt-4; drop",
      confidence_threshold: 7,
      monthly_ai_call_limit: -1,
      handoff_message: "   ",
      ai_timeout_ms: 120000,
    });
    expect(warnings.length).toBe(6);
    expect(config).toMatchObject({
      aiEnabled: false,
      aiModel: "claude-haiku-5-5",
      confidenceThreshold: 0.7,
      monthlyAiCallLimit: 6000,
      handoffMessage: DEFAULT_CONFIG.handoffMessage,
      aiTimeoutMs: 15000,
    });
  });
});

describe("dayKey", () => {
  it("tính ngày theo giờ Việt Nam", () => {
    expect(dayKey(new Date("2026-11-15T17:30:00Z"))).toBe("2026-11-16");
    expect(dayKey(new Date("2026-11-15T16:59:00Z"))).toBe("2026-11-15");
  });
});

describe("monthKey", () => {
  it("tính tháng theo giờ Việt Nam (UTC+7)", () => {
    // 31/10/2026 18:30 UTC = 01/11/2026 01:30 giờ Việt Nam
    expect(monthKey(new Date("2026-10-31T18:30:00Z"))).toBe("2026-11");
    expect(monthKey(new Date("2026-10-31T16:59:00Z"))).toBe("2026-10");
  });
});

describe("parseConfig: max_images_per_answer (bước E)", () => {
  it("mặc định 4; nhận số nguyên 0-10", () => {
    expect(DEFAULT_CONFIG.maxImagesPerAnswer).toBe(4);
    expect(parseConfig({ max_images_per_answer: 0 }).config.maxImagesPerAnswer).toBe(0);
    expect(parseConfig({ max_images_per_answer: 10 }).config.maxImagesPerAnswer).toBe(10);
  });
  it("ngoài khoảng, số lẻ hoặc sai kiểu → mặc định và cảnh báo", () => {
    for (const v of [11, -1, 2.5, "4"]) {
      const { config, warnings } = parseConfig({ max_images_per_answer: v });
      expect(config.maxImagesPerAnswer).toBe(4);
      expect(warnings).toHaveLength(1);
    }
  });
});
