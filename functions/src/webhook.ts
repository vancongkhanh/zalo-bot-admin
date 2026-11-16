/**
 * Luồng xử lý chính của zaloWebhook (spec giai đoạn 1, mục 6).
 *
 * Hàm `handleWebhook` không phụ thuộc trực tiếp vào Firebase: store, client Zalo,
 * logger và đồng hồ được truyền vào, để kiểm thử đơn vị được.
 */
import { BotConfig, QUOTA_WARNING_RATIO, dayKey, monthKey } from "./config";
import { buildAnswerText, clusterKey, KbItem, sampleText, unansweredId } from "./kb";
import { stripMention } from "./mention";
import { SECRET_HEADER, headerValue, safeEqual } from "./security";
import { AiClient, selectItem, Selection } from "./selector";
import type { ConversationRecord, HandoffReason, Store } from "./store";
import { MAX_TEXT_LENGTH, ZaloClient } from "./zaloClient";

export interface WebhookRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface WebhookResponse {
  status: number;
  body: string;
}

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface WebhookDeps {
  webhookSecret: string;
  store: Store;
  /** Tạo client khi cần gửi tin (tránh đọc token nếu không gửi). */
  getZaloClient: () => ZaloClient;
  /** Tạo client Anthropic khi cần gọi AI (bước C). */
  getAiClient?: () => AiClient;
  logger: Logger;
  now?: () => number;
}

export const TEXT_EVENT = "message.text.received";
export const GROUP_CHAT = "GROUP";
export const REPLY_PREFIX = "Đã nhận: ";

export function guidanceText(botName: string): string {
  return `Vui lòng nhắn @${botName} kèm câu hỏi.`;
}

/** Cắt chuỗi còn tối đa `max` ký tự Unicode. */
export function truncateChars(s: string, max = MAX_TEXT_LENGTH): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max).join("");
}

export function buildReplyText(question: string, botName: string): string {
  if (!question) return guidanceText(botName);
  return truncateChars(REPLY_PREFIX + question);
}

// ---------- Đọc sự kiện ----------

interface ZaloUpdate {
  event_name?: unknown;
  message?: unknown;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Trường chứa thông tin cá nhân hoặc nội dung; bị che khi ghi thân thô. */
const REDACT_KEYS = new Set(["display_name", "text", "caption", "photo_url", "name"]);

/** Bản sao thân yêu cầu đã che nội dung, mã người dùng; giữ nguyên cấu trúc và kiểu. */
export function redactBody(value: unknown, parentKey = ""): unknown {
  if (Array.isArray(value)) return value.map((v) => redactBody(v, parentKey));
  if (isObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (REDACT_KEYS.has(k) && typeof v === "string") {
        out[k] = `[redacted ${Array.from(v).length} ký tự]`;
      } else if (parentKey === "from" && k === "id" && typeof v === "string") {
        out[k] = "[redacted]";
      } else if (parentKey === "chat" && k === "id" && typeof v === "string" && value.chat_type !== "GROUP") {
        // Chat riêng: chat.id chính là mã người dùng. Chỉ giữ mã nhóm.
        out[k] = "[redacted]";
      } else {
        out[k] = redactBody(v, k);
      }
    }
    return out;
  }
  return value;
}

// ---------- Luồng chính ----------

export async function handleWebhook(
  req: WebhookRequest,
  deps: WebhookDeps,
): Promise<WebhookResponse> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const { store, logger } = deps;

  // 1. Chỉ nhận POST.
  if (req.method !== "POST") {
    return { status: 405, body: "Method Not Allowed" };
  }

  // 2. Xác thực. Sai/thiếu: 401, không xử lý, không ghi gì.
  if (!safeEqual(headerValue(req.headers, SECRET_HEADER), deps.webhookSecret)) {
    return { status: 401, body: "Unauthorized" };
  }

  // Từ đây luôn trả 200 (bước 10), kể cả khi có lỗi.
  const OK: WebhookResponse = { status: 200, body: "ok" };
  let messageId: string | null = null;
  let claimed = false;

  try {
    const { config, warnings } = await store.getConfig();
    for (const w of warnings) logger.warn("Cấu hình config/main", { warning: w });

    const body = req.body;
    if (config.logRawBody) {
      logger.info("Thân webhook (đã che)", { body: redactBody(body) });
    }

    // Chấp nhận cả hai dạng: { event_name, message } và { result: { ... } }.
    const wrapped = isObject(body) && isObject(body.result);
    const update = (wrapped ? (body as { result: unknown }).result : body) as ZaloUpdate;
    if (wrapped) logger.info("Thân webhook có bọc 'result'");

    if (!isObject(update) || !isObject(update.message)) {
      logger.warn("Thân webhook khác mẫu: thiếu 'message'", { body: redactBody(body) });
      return OK;
    }

    const msg = update.message as Record<string, unknown>;
    const chat = (isObject(msg.chat) ? msg.chat : {}) as Record<string, unknown>;
    const from = (isObject(msg.from) ? msg.from : {}) as Record<string, unknown>;
    const eventName = str(update.event_name);
    messageId = str(msg.message_id);
    const chatId = str(chat.id);
    const chatType = str(chat.chat_type);
    const fromId = str(from.id);
    const displayName = str(from.display_name);

    if (!messageId) {
      logger.warn("Thân webhook khác mẫu: thiếu message_id", { body: redactBody(body) });
      return OK;
    }

    const baseRecord = {
      chat_id: chatId,
      from_id: fromId,
      display_name: displayName,
    };
    const writeIgnored = (reason: string, question: string | null = null) =>
      store.writeConversation(messageId as string, {
        ...baseRecord,
        question,
        reply_text: null,
        outcome: "ignored",
        ignore_reason: reason,
        error: null,
        duration_ms: now() - startedAt,
      });

    // 3. Phân loại sự kiện: chỉ tin chữ trong nhóm. Không lưu nội dung các sự kiện này.
    if (eventName !== TEXT_EVENT) {
      await writeIgnored(`unsupported_event:${eventName ?? "unknown"}`);
      logger.info("Bỏ qua sự kiện không hỗ trợ", { event_name: eventName, message_id: messageId });
      return OK;
    }
    if (chatType !== GROUP_CHAT) {
      await writeIgnored(`not_group:${chatType ?? "unknown"}`);
      logger.info("Bỏ qua tin không phải nhóm", { chat_type: chatType, message_id: messageId });
      return OK;
    }

    // 4. Nhóm phải nằm trong danh sách cho phép. Không lưu conversations cho nhóm lạ.
    if (!chatId || !config.allowedChatIds.includes(chatId)) {
      const chatName = str(chat.name) ?? str(chat.title) ?? str(chat.display_name);
      logger.warn("Nhóm không được phép", { chat_id: chatId, chat_name: chatName, message_id: messageId });
      return OK;
    }

    // 5. Chống trùng.
    claimed = await store.claimEvent(messageId);
    if (!claimed) {
      logger.info("Sự kiện trùng, bỏ qua", { message_id: messageId, chat_id: chatId });
      return OK;
    }

    // 6. Cắt @tên bot.
    const rawText = typeof msg.text === "string" ? msg.text : "";
    const { text: question, hadMention } = stripMention(rawText, config.botMentionName);
    if (!hadMention) {
      await writeIgnored("no_mention", question);
      await store.setEventState(messageId, "done");
      return OK;
    }

    if (!config.replyEnabled) {
      await writeIgnored("reply_disabled", question);
      await store.setEventState(messageId, "done");
      return OK;
    }

    // 7. Hạn mức tháng.
    const month = monthKey(new Date(now()));
    const sent = await store.getMonthlySent(month);
    if (sent >= config.monthlyMessageLimit) {
      logger.warn("Đã hết hạn mức tin gửi trong tháng", {
        month,
        messages_sent: sent,
        limit: config.monthlyMessageLimit,
      });
      await writeIgnored("quota", question);
      await store.setEventState(messageId, "done");
      return OK;
    }

    // 8. Bước C: chọn mục bằng AI (khi bật và có câu hỏi).
    if (config.aiEnabled && question) {
      await answerWithAi({ deps, config, messageId, chatId, question, month, sent, baseRecord, startedAt, now });
      return OK;
    }

    // 8. Trả lời như giai đoạn 1.
    const replyText = buildReplyText(question, config.botMentionName);
    const result = await deps.getZaloClient().sendMessage(chatId, replyText);

    let record: ConversationRecord;
    if (result.ok) {
      await store.recordSendSuccess(month);
      await maybeWarnQuota(store, logger, config, month, sent + 1);
      record = {
        ...baseRecord,
        question,
        reply_text: replyText,
        outcome: "replied",
        ignore_reason: null,
        error: null,
        duration_ms: now() - startedAt,
      };
    } else {
      await store.recordSendError(month);
      logger.error("Gửi tin thất bại", { message_id: messageId, chat_id: chatId, error: result.error });
      record = {
        ...baseRecord,
        question,
        reply_text: replyText,
        outcome: "error",
        ignore_reason: null,
        error: `${result.error.code}: ${result.error.description}`,
        duration_ms: now() - startedAt,
      };
    }

    // 9. Nhật ký, trạng thái, thời gian xử lý.
    await store.writeConversation(messageId, record);
    await store.setEventState(messageId, result.ok ? "done" : "failed");
    logger.info("Đã xử lý sự kiện", {
      message_id: messageId,
      chat_id: chatId,
      outcome: record.outcome,
      duration_ms: record.duration_ms,
    });
    return OK;
  } catch (err) {
    logger.error("Lỗi khi xử lý webhook", {
      message_id: messageId,
      error: err instanceof Error ? err.message : String(err),
    });
    if (claimed && messageId) {
      try {
        await store.setEventState(messageId, "failed");
      } catch {
        /* bỏ qua: đã ghi lỗi ở trên */
      }
    }
    return OK;
  }
}

// ---------- Bước C ----------

interface AiFlowInput {
  deps: WebhookDeps;
  config: BotConfig;
  messageId: string;
  chatId: string;
  question: string;
  month: string;
  sent: number;
  baseRecord: Pick<ConversationRecord, "chat_id" | "from_id" | "display_name">;
  startedAt: number;
  now: () => number;
}

interface Decision {
  item: KbItem | null;
  reason: HandoffReason | null;
  selection: Selection | null;
}

/** Quyết định trả lời hay chuyển ca (mục 4.2 bước 4-8). */
async function decide(input: AiFlowInput): Promise<Decision> {
  const { deps, config, question, month } = input;
  const aiCalls = await deps.store.getMonthlyAiCalls(month);
  if (aiCalls >= config.monthlyAiCallLimit) {
    deps.logger.warn("Đã hết hạn mức gọi AI trong tháng", { month, ai_calls: aiCalls, limit: config.monthlyAiCallLimit });
    return { item: null, reason: "ai_quota", selection: null };
  }
  const items = await deps.store.getApprovedItems();
  if (items.length === 0 || !deps.getAiClient) {
    if (!deps.getAiClient) deps.logger.error("Thiếu client AI");
    return { item: null, reason: items.length === 0 ? "no_match" : "ai_error", selection: null };
  }
  const selection = await selectItem(question, items, {
    client: deps.getAiClient(),
    model: config.aiModel,
    timeoutMs: config.aiTimeoutMs,
    now: input.now,
  });
  await deps.store.recordAiCall(month, {
    ok: selection.ok,
    inputTokens: selection.inputTokens,
    outputTokens: selection.outputTokens,
  });
  if (!selection.ok) {
    deps.logger.error("Lỗi gọi AI", { message_id: input.messageId, error: selection.error, ai_ms: selection.ms });
    return { item: null, reason: "ai_error", selection };
  }
  if (!selection.slug) return { item: null, reason: "no_match", selection };
  if (selection.confidence < config.confidenceThreshold) return { item: null, reason: "low_confidence", selection };
  return { item: items.find((i) => i.slug === selection.slug) ?? null, reason: null, selection };
}

async function answerWithAi(input: AiFlowInput): Promise<void> {
  const { deps, config, messageId, chatId, question, month, sent, now } = input;
  const { store, logger } = deps;
  const { item, reason, selection } = await decide(input);
  const okSel = selection?.ok ? selection : null;

  let replyText: string;
  if (item) {
    const built = buildAnswerText(item);
    replyText = built.text;
    if (built.droppedLinks > 0) {
      logger.warn("Câu trả lời quá 2.000 ký tự, đã bỏ bớt link", { slug: item.slug, dropped_links: built.droppedLinks });
    }
  } else {
    replyText = config.handoffMessage;
  }

  const result = await deps.getZaloClient().sendMessage(chatId, replyText);
  if (result.ok) {
    await store.recordSendSuccess(month);
  } else {
    await store.recordSendError(month);
    logger.error("Gửi tin thất bại", { message_id: messageId, chat_id: chatId, error: result.error });
  }
  await maybeWarnQuota(store, logger, config, month, sent + 1);

  const outcome = item ? "answered" : "handoff";
  await store.recordDailyStat(dayKey(new Date(now())), {
    outcome,
    aiError: reason === "ai_error",
    slug: item && result.ok ? item.slug : null,
  });
  if (item && result.ok) await store.recordHit(item.slug);
  if (!item && reason) {
    const key = clusterKey(question);
    await store.recordUnanswered({
      id: unansweredId(key),
      clusterKey: key,
      sample: sampleText(question),
      reason,
      bestGuessSlug: okSel?.slug ?? null,
      bestGuessConfidence: okSel?.slug ? okSel.confidence : null,
    });
  }

  const record: ConversationRecord = {
    ...input.baseRecord,
    question,
    reply_text: replyText,
    outcome,
    ignore_reason: null,
    error: result.ok ? null : `${result.error.code}: ${result.error.description}`,
    duration_ms: now() - input.startedAt,
    matched_slug: item?.slug ?? null,
    confidence: okSel ? okSel.confidence : null,
    reason,
    ai_ms: selection?.ms ?? null,
    send_ok: result.ok,
  };
  await store.writeConversation(messageId, record);
  await store.setEventState(messageId, result.ok ? "done" : "failed");
  logger.info("Đã xử lý sự kiện", {
    message_id: messageId,
    chat_id: chatId,
    outcome,
    reason,
    matched_slug: record.matched_slug,
    confidence: record.confidence,
    ai_ms: record.ai_ms,
    duration_ms: record.duration_ms,
  });
}

async function maybeWarnQuota(
  store: Store,
  logger: Logger,
  config: BotConfig,
  month: string,
  sentAfter: number,
): Promise<void> {
  const threshold = config.monthlyMessageLimit * QUOTA_WARNING_RATIO;
  if (config.monthlyMessageLimit > 0 && sentAfter >= threshold) {
    if (await store.markQuotaWarning(month)) {
      logger.warn("Đã dùng 80% hạn mức tin gửi trong tháng", {
        month,
        messages_sent: sentAfter,
        limit: config.monthlyMessageLimit,
      });
    }
  }
}
