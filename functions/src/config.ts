import { defineSecret } from "firebase-functions/params";

/** Secrets lưu bằng `firebase functions:secrets:set`; không bao giờ ghi vào mã hay nhật ký. */
export const ZALO_BOT_TOKEN = defineSecret("ZALO_BOT_TOKEN");
export const ZALO_WEBHOOK_SECRET = defineSecret("ZALO_WEBHOOK_SECRET");

/** Cấu hình đọc từ Firestore `config/main`. */
export interface BotConfig {
  allowedChatIds: string[];
  botMentionName: string;
  monthlyMessageLimit: number;
  replyEnabled: boolean;
  /** Ghi thân yêu cầu (đã che thông tin cá nhân) ra Cloud Logging để kiểm chứng cấu trúc. */
  logRawBody: boolean;
}

export const DEFAULT_CONFIG: BotConfig = {
  allowedChatIds: [],
  botMentionName: "Bot TTHC Đảng",
  monthlyMessageLimit: 3000,
  replyEnabled: true,
  logRawBody: true,
};

/** Tỷ lệ hạn mức để ghi cảnh báo. */
export const QUOTA_WARNING_RATIO = 0.8;

/** Múi giờ dùng để tính tháng cho bộ đếm `usage/{YYYY-MM}`. */
export const USAGE_TIMEZONE = "Asia/Ho_Chi_Minh";

/**
 * Chuyển dữ liệu thô của `config/main` thành BotConfig.
 * Trường thiếu hoặc sai kiểu thì dùng giá trị mặc định; trả kèm danh sách cảnh báo.
 */
export function parseConfig(raw: Record<string, unknown> | undefined): {
  config: BotConfig;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (!raw) {
    return { config: { ...DEFAULT_CONFIG }, warnings: ["config/main không tồn tại, dùng mặc định"] };
  }
  const config = { ...DEFAULT_CONFIG };

  if (Array.isArray(raw.allowed_chat_ids)) {
    config.allowedChatIds = raw.allowed_chat_ids
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);
  } else if (raw.allowed_chat_ids !== undefined) {
    warnings.push("allowed_chat_ids không phải mảng");
  }

  if (typeof raw.bot_mention_name === "string" && raw.bot_mention_name.trim()) {
    config.botMentionName = raw.bot_mention_name.trim();
  } else if (raw.bot_mention_name !== undefined) {
    warnings.push("bot_mention_name không hợp lệ");
  }

  if (typeof raw.monthly_message_limit === "number" && raw.monthly_message_limit >= 0) {
    config.monthlyMessageLimit = raw.monthly_message_limit;
  } else if (raw.monthly_message_limit !== undefined) {
    warnings.push("monthly_message_limit không hợp lệ");
  }

  if (typeof raw.reply_enabled === "boolean") {
    config.replyEnabled = raw.reply_enabled;
  } else if (raw.reply_enabled !== undefined) {
    warnings.push("reply_enabled không phải boolean");
  }

  if (typeof raw.log_raw_body === "boolean") {
    config.logRawBody = raw.log_raw_body;
  } else if (raw.log_raw_body !== undefined) {
    warnings.push("log_raw_body không phải boolean");
  }

  return { config, warnings };
}

/** "YYYY-MM" theo múi giờ Việt Nam. */
export function monthKey(date: Date, timeZone = USAGE_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return `${y}-${m}`;
}
