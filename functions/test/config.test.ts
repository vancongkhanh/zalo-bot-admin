import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, monthKey, parseConfig } from "../src/config";

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
      allowedChatIds: ["zgr-a", "zgr-b"],
      botMentionName: "Bot TTHC Đảng",
      monthlyMessageLimit: 3000,
      replyEnabled: false,
      logRawBody: false,
    });
  });

  it("sai kiểu → dùng mặc định và cảnh báo", () => {
    const { config, warnings } = parseConfig({ allowed_chat_ids: "zgr-a", reply_enabled: "true" });
    expect(config.allowedChatIds).toEqual([]);
    expect(config.replyEnabled).toBe(true);
    expect(warnings.length).toBe(2);
  });
});

describe("monthKey", () => {
  it("tính tháng theo giờ Việt Nam (UTC+7)", () => {
    // 31/10/2026 18:30 UTC = 01/11/2026 01:30 giờ Việt Nam
    expect(monthKey(new Date("2026-10-31T18:30:00Z"))).toBe("2026-11");
    expect(monthKey(new Date("2026-10-31T16:59:00Z"))).toBe("2026-10");
  });
});
