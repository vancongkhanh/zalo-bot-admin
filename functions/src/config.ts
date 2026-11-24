import { defineSecret } from "firebase-functions/params";

/** Secrets lưu bằng `firebase functions:secrets:set`; không bao giờ ghi vào mã hay nhật ký. */
export const ZALO_BOT_TOKEN = defineSecret("ZALO_BOT_TOKEN");
export const ZALO_WEBHOOK_SECRET = defineSecret("ZALO_WEBHOOK_SECRET");
export const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
/**
 * OA-0 (zaloOaWebhook): hai khóa ứng viên để thử chữ ký. Phải tồn tại trong Secret Manager
 * khi deploy hàm này; chưa có khóa thật thì đặt giá trị `none` (hàm coi là "skipped").
 */
export const ZALO_OA_SECRET_KEY = defineSecret("ZALO_OA_SECRET_KEY");
export const ZALO_APP_SECRET_KEY = defineSecret("ZALO_APP_SECRET_KEY");

/** Cấu hình đọc từ Firestore `config/main`. */
export interface BotConfig {
  allowedChatIds: string[];
  botMentionName: string;
  monthlyMessageLimit: number;
  replyEnabled: boolean;
  /** Ghi thân yêu cầu (đã che thông tin cá nhân) ra Cloud Logging để kiểm chứng cấu trúc. */
  logRawBody: boolean;
  // Bước C
  aiEnabled: boolean;
  aiModel: string;
  confidenceThreshold: number;
  monthlyAiCallLimit: number;
  handoffMessage: string;
  aiTimeoutMs: number;
  // Bước E
  /** Số ảnh tối đa gửi kèm một câu trả lời (0-10); ảnh còn lại thành link. */
  maxImagesPerAnswer: number;
  // Bước F
  /** Đọc ảnh người dùng gửi (có gọi tên bot) bằng AI. */
  imageAiEnabled: boolean;
  /** Số lượt đọc ảnh tối đa mỗi tháng; vẫn tính vào monthlyAiCallLimit. */
  monthlyImageAiLimit: number;
  /** Tin gửi khi hết hạn mức đọc ảnh. */
  imageQuotaMessage: string;
  /** AI trả thêm mô tả ngắn của ảnh, chỉ lưu cho quản trị. */
  imageSummaryEnabled: boolean;
  /** Bước G: AI chép chữ đọc được trên ảnh (thông tin cá nhân bọc ⟦…⟧), chỉ lưu cho quản trị. */
  imageTextEnabled: boolean;
}

export const DEFAULT_CONFIG: BotConfig = {
  allowedChatIds: [],
  botMentionName: "Bot TTHC Đảng",
  monthlyMessageLimit: 3000,
  replyEnabled: true,
  logRawBody: true,
  aiEnabled: false,
  aiModel: "claude-haiku-5-5",
  confidenceThreshold: 0.7,
  monthlyAiCallLimit: 6000,
  handoffMessage: "Câu hỏi của anh/chị đã được ghi nhận, chuyên viên sẽ hỗ trợ sớm.",
  aiTimeoutMs: 15000,
  maxImagesPerAnswer: 4,
  imageAiEnabled: false,
  monthlyImageAiLimit: 300,
  imageQuotaMessage: "Bot tạm không đọc được ảnh, bạn gõ câu hỏi bằng chữ giúp nhé.",
  imageSummaryEnabled: true,
  imageTextEnabled: true,
};

/** Giới hạn an toàn cho các trường bước C (hàm có timeout 60 giây). */
export const AI_TIMEOUT_RANGE = { min: 1000, max: 50000 } as const;
export const MODEL_PATTERN = /^claude-[a-z0-9-]{1,60}$/;
export const MAX_HANDOFF_CHARS = 1000;
/** Bước E: số ảnh gửi mỗi câu trả lời, và số ảnh tối đa của một mục. */
export const MAX_IMAGES_PER_ITEM = 10;
/** Bước F: giới hạn các trường đọc ảnh. */
export const MAX_IMAGE_AI_LIMIT = 10000;
export const MAX_IMAGE_QUOTA_MESSAGE_CHARS = 500;

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

  if (typeof raw.ai_enabled === "boolean") config.aiEnabled = raw.ai_enabled;
  else if (raw.ai_enabled !== undefined) warnings.push("ai_enabled không phải boolean");

  if (typeof raw.ai_model === "string" && MODEL_PATTERN.test(raw.ai_model.trim())) {
    config.aiModel = raw.ai_model.trim();
  } else if (raw.ai_model !== undefined) {
    warnings.push("ai_model không hợp lệ");
  }

  const threshold = raw.confidence_threshold;
  if (typeof threshold === "number" && Number.isFinite(threshold) && threshold >= 0 && threshold <= 1) {
    config.confidenceThreshold = threshold;
  } else if (threshold !== undefined) {
    warnings.push("confidence_threshold phải là số từ 0 đến 1");
  }

  const aiLimit = raw.monthly_ai_call_limit;
  if (typeof aiLimit === "number" && Number.isFinite(aiLimit) && aiLimit >= 0) {
    config.monthlyAiCallLimit = aiLimit;
  } else if (aiLimit !== undefined) {
    warnings.push("monthly_ai_call_limit không hợp lệ");
  }

  const handoff = raw.handoff_message;
  if (typeof handoff === "string" && handoff.trim() && Array.from(handoff.trim()).length <= MAX_HANDOFF_CHARS) {
    config.handoffMessage = handoff.trim();
  } else if (handoff !== undefined) {
    warnings.push("handoff_message trống hoặc quá dài");
  }

  const timeout = raw.ai_timeout_ms;
  if (
    typeof timeout === "number" &&
    Number.isFinite(timeout) &&
    timeout >= AI_TIMEOUT_RANGE.min &&
    timeout <= AI_TIMEOUT_RANGE.max
  ) {
    config.aiTimeoutMs = Math.round(timeout);
  } else if (timeout !== undefined) {
    warnings.push(`ai_timeout_ms phải từ ${AI_TIMEOUT_RANGE.min} đến ${AI_TIMEOUT_RANGE.max}`);
  }

  const maxImages = raw.max_images_per_answer;
  if (
    typeof maxImages === "number" &&
    Number.isInteger(maxImages) &&
    maxImages >= 0 &&
    maxImages <= MAX_IMAGES_PER_ITEM
  ) {
    config.maxImagesPerAnswer = maxImages;
  } else if (maxImages !== undefined) {
    warnings.push(`max_images_per_answer phải là số nguyên từ 0 đến ${MAX_IMAGES_PER_ITEM}`);
  }

  if (typeof raw.image_ai_enabled === "boolean") config.imageAiEnabled = raw.image_ai_enabled;
  else if (raw.image_ai_enabled !== undefined) warnings.push("image_ai_enabled không phải boolean");

  if (typeof raw.image_summary_enabled === "boolean") config.imageSummaryEnabled = raw.image_summary_enabled;
  else if (raw.image_summary_enabled !== undefined) warnings.push("image_summary_enabled không phải boolean");

  if (typeof raw.image_text_enabled === "boolean") config.imageTextEnabled = raw.image_text_enabled;
  else if (raw.image_text_enabled !== undefined) warnings.push("image_text_enabled không phải boolean");

  const imageLimit = raw.monthly_image_ai_limit;
  if (typeof imageLimit === "number" && Number.isInteger(imageLimit) && imageLimit >= 0 && imageLimit <= MAX_IMAGE_AI_LIMIT) {
    config.monthlyImageAiLimit = imageLimit;
  } else if (imageLimit !== undefined) {
    warnings.push(`monthly_image_ai_limit phải là số nguyên từ 0 đến ${MAX_IMAGE_AI_LIMIT}`);
  }

  const imageQuota = raw.image_quota_message;
  if (
    typeof imageQuota === "string" &&
    imageQuota.trim() &&
    Array.from(imageQuota.trim()).length <= MAX_IMAGE_QUOTA_MESSAGE_CHARS
  ) {
    config.imageQuotaMessage = imageQuota.trim();
  } else if (imageQuota !== undefined) {
    warnings.push("image_quota_message trống hoặc quá dài");
  }

  return { config, warnings };
}

/** "YYYY-MM-DD" theo múi giờ Việt Nam (cho `stats_daily`). */
export function dayKey(date: Date, timeZone = USAGE_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
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
