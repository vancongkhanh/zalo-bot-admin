/**
 * Trả lời người đã hỏi từ trang quản trị (spec trả lời người hỏi, mục 5).
 *
 * Hàm thuần: kiểm tra quyền, kho dữ liệu, client Zalo, đồng hồ được truyền vào để kiểm thử.
 * Nguyên tắc R1–R3: chat_id đích CHỈ lấy từ ask đã lưu; input không có chat_id (trường lạ bị bỏ qua);
 * ask khác chat_id không bao giờ chung một tin.
 */
import type { BotConfig } from "./config";
import { monthKey } from "./config";
import { buildReplyMessage } from "./replyMessage";
import type { AskReplyStatus } from "./store";
import { charLength, MAX_TEXT_LENGTH, ZaloClient, ZaloError } from "./zaloClient";

/** Nghỉ giữa hai lần gửi vào hai nhóm khác nhau. */
export const SEND_GAP_MS = 500;
export const MAX_ASK_IDS = 100;
/** Ask kẹt ở `sending` quá lâu (hàm chết giữa chừng) thì được nhận lại. Lớn hơn timeout hàm (540 giây). */
export const SENDING_STALE_MS = 15 * 60 * 1000;

const DOC_ID = /^(?!\.\.?$)[^/]{1,200}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** `sending`: đã nhận để gửi, chưa có kết quả (chống hai lần bấm cùng lúc). */
export type StoredAskStatus = AskReplyStatus | "sending";

export interface StoredAsk {
  id: string;
  chatId: string | null;
  chatType: string | null;
  fromId: string | null;
  displayName: string | null;
  question: string;
  askedAtMs: number | null;
  source: string | null;
  status: StoredAskStatus;
}

export type SkipReason = "ALREADY_SENT" | "ALREADY_SKIPPED" | "IN_PROGRESS";

export type ClaimResult =
  | { ok: false; reason: "unanswered_not_found" | "ask_not_found"; missing: string[] }
  | { ok: true; claimed: StoredAsk[]; skipped: { ask: StoredAsk; reason: SkipReason }[] };

export type GroupOutcome = { status: "sent" } | { status: "failed"; error: string };

export interface ReplyResultEntry {
  chat_id: string | null;
  chat_name: string | null;
  ask_ids: string[];
  ask_count: number;
  status: "sent" | "failed" | "skipped";
  error: string | null;
  /** Tin đã dựng (sent/failed sau khi dựng được), để trang hiện đúng tin đã gửi. */
  text: string | null;
}

export interface AdminReplyRecord {
  unanswered_id: string;
  kb_item_id: string | null;
  answer_text: string;
  sent_by: string | null;
  sent_by_uid: string;
  results: { chat_id: string | null; ask_ids: string[]; status: ReplyResultEntry["status"]; error: string | null; sent_at_ms: number | null }[];
}

/**
 * Bản ghi tin đi trong `conversations` (Lịch sử) cho mỗi nhóm gửi được (spec mục 4.3, Bước 6).
 * `outcome: "admin_reply"` tách khỏi bot trả lời tự động; không cộng vào `stats_daily`.
 */
export interface AdminReplyConversation {
  chat_id: string;
  chat_type: string | null;
  from_id: null;
  display_name: null;
  /** Câu hỏi mới nhất trong nhóm (cắt 500 ký tự), để Lịch sử hiện như tin người dùng. */
  question: string;
  reply_text: string;
  outcome: "admin_reply";
  ignore_reason: null;
  error: null;
  duration_ms: number;
  matched_slug: string | null;
  send_ok: true;
  admin_batch_id: string;
  unanswered_id: string;
  ask_ids: string[];
  /** Tên người được trả lời (không trùng, theo thứ tự hỏi). */
  reply_to_names: string[];
  sent_by: string | null;
}

export const MAX_OUTBOUND_QUESTION_CHARS = 500;

export function outboundId(batchId: string, index: number): string {
  return `admin_reply_${batchId}_${index}`;
}

export interface ReplyRepo {
  /** Transaction: ask pending/failed (hoặc sending đã quá hạn) → sending. Thiếu tài liệu nào thì không ghi gì. */
  claimAsks(unansweredId: string, askIds: string[], batchId: string): Promise<ClaimResult>;
  /** Ghi kết quả một nhóm; gửi được thì giảm pending_ask_count. */
  finishGroup(unansweredId: string, batchId: string, askIds: string[], outcome: GroupOutcome): Promise<void>;
  writeBatch(batchId: string, record: AdminReplyRecord): Promise<void>;
  /** `conversations/{id}` với created_at, expire_at như tin của bot. */
  writeOutbound(id: string, record: AdminReplyConversation): Promise<void>;
  getMonthlySent(month: string): Promise<number>;
  /** Như bot: messages_sent đếm cả lần lỗi; thêm admin_replies_sent / admin_reply_errors. */
  recordSend(month: string, ok: boolean): Promise<void>;
  skipAsks(
    unansweredId: string,
    askIds: string[],
    by: string | null,
  ): Promise<{ ok: false; reason: "unanswered_not_found" | "ask_not_found"; missing: string[] } | { ok: true; skipped: string[]; unchanged: string[] }>;
}

export interface ReplyLogger {
  info(m: string, d?: Record<string, unknown>): void;
  warn(m: string, d?: Record<string, unknown>): void;
  error(m: string, d?: Record<string, unknown>): void;
}

export interface ReplyDeps {
  isAdmin(uid: string): Promise<boolean>;
  repo: ReplyRepo;
  getConfig(): Promise<BotConfig>;
  getZaloClient(): ZaloClient;
  logger: ReplyLogger;
  newBatchId(): string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface Caller {
  uid?: string;
  email?: string | null;
}

type ErrCode = "unauthenticated" | "permission-denied" | "invalid-argument" | "not-found";
export type HandlerError = { ok: false; code: ErrCode; message: string };

async function checkCaller(caller: Caller, deps: ReplyDeps): Promise<HandlerError | null> {
  if (!caller.uid) return { ok: false, code: "unauthenticated", message: "Cần đăng nhập." };
  if (!(await deps.isAdmin(caller.uid))) {
    return { ok: false, code: "permission-denied", message: "Tài khoản chưa có quyền quản trị." };
  }
  return null;
}

const bad = (message: string): HandlerError => ({ ok: false, code: "invalid-argument", message });

function parseIds(d: Record<string, unknown>): { unansweredId: string; askIds: string[] } | HandlerError {
  const unansweredId = d.unansweredId;
  if (typeof unansweredId !== "string" || !DOC_ID.test(unansweredId)) return bad("unansweredId không hợp lệ.");
  const raw = d.askIds;
  if (!Array.isArray(raw) || raw.length === 0) return bad("Chọn ít nhất một người hỏi.");
  if (raw.length > MAX_ASK_IDS) return bad(`Tối đa ${MAX_ASK_IDS} lượt hỏi mỗi lần.`);
  if (!raw.every((x) => typeof x === "string" && DOC_ID.test(x))) return bad("askIds không hợp lệ.");
  return { unansweredId, askIds: [...new Set(raw as string[])] };
}

export interface SendInput {
  unansweredId: string;
  answerText: string;
  askIds: string[];
  kbItemId: string | null;
}

/** Chỉ đọc 4 trường của spec; mọi trường khác (kể cả chat_id) bị bỏ qua (R2, A17). */
export function parseSendInput(data: unknown): SendInput | HandlerError {
  const d = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  const ids = parseIds(d);
  if ("ok" in ids) return ids;
  const answerText = typeof d.answerText === "string" ? d.answerText.trim() : "";
  if (!answerText) return bad("Đáp án gửi đi đang trống.");
  if (charLength(answerText) > MAX_TEXT_LENGTH) return bad(`Đáp án dài quá ${MAX_TEXT_LENGTH} ký tự.`);
  const k = d.kbItemId;
  if (k !== undefined && k !== null && (typeof k !== "string" || !SLUG.test(k) || k.length > 80)) {
    return bad("kbItemId không hợp lệ.");
  }
  return { ...ids, answerText, kbItemId: typeof k === "string" ? k : null };
}

export function zaloErrorText(e: ZaloError): string {
  return `${e.code}${e.zaloErrorCode !== undefined ? `[${e.zaloErrorCode}]` : ""}: ${e.description}`;
}

function outboundRecord(
  asks: StoredAsk[],
  text: string,
  o: { batchId: string; input: SendInput; sentBy: string | null; durationMs: number },
): AdminReplyConversation {
  const sorted = [...asks].sort((a, b) => (a.askedAtMs ?? 0) - (b.askedAtMs ?? 0));
  const names: string[] = [];
  const seen = new Set<string>();
  for (const a of sorted) {
    const name = a.displayName?.trim();
    const key = a.fromId || name;
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return {
    chat_id: asks[0].chatId!,
    chat_type: asks[0].chatType,
    from_id: null,
    display_name: null,
    question: [...(sorted[sorted.length - 1]?.question ?? "")].slice(0, MAX_OUTBOUND_QUESTION_CHARS).join(""),
    reply_text: text,
    outcome: "admin_reply",
    ignore_reason: null,
    error: null,
    duration_ms: o.durationMs,
    matched_slug: o.input.kbItemId,
    send_ok: true,
    admin_batch_id: o.batchId,
    unanswered_id: o.input.unansweredId,
    ask_ids: asks.map((a) => a.id),
    reply_to_names: names,
    sent_by: o.sentBy,
  };
}

export type SendResponse =HandlerError | { ok: true; batchId: string; results: ReplyResultEntry[] };

export async function handleSendReply(caller: Caller, data: unknown, deps: ReplyDeps): Promise<SendResponse> {
  const denied = await checkCaller(caller, deps);
  if (denied) return denied;
  const input = parseSendInput(data);
  if ("ok" in input) return input;

  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const { logger, repo } = deps;
  const config = await deps.getConfig();
  const batchId = deps.newBatchId();

  const claim = await repo.claimAsks(input.unansweredId, input.askIds, batchId);
  if (!claim.ok) {
    return claim.reason === "unanswered_not_found"
      ? { ok: false, code: "not-found", message: "Câu hỏi không còn tồn tại." }
      : bad(`Có lượt hỏi không thuộc câu này: ${claim.missing.join(", ")}`);
  }

  const label = (chatId: string | null) => (chatId ? config.chatLabels[chatId] ?? null : null);

  // R3: gom theo chat_id của ask. chat_id rỗng: mỗi ask một nhóm riêng (không gửi, R5).
  const groups = new Map<string, StoredAsk[]>();
  for (const a of claim.claimed) {
    const key = a.chatId ? `c:${a.chatId}` : `x:${a.id}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }

  const results: ReplyResultEntry[] = [];
  const sentAt = new Map<ReplyResultEntry, number>();
  const month = monthKey(new Date(now()));
  let sent = await repo.getMonthlySent(month);
  let calls = 0;
  const pending = [...groups.values()];

  try {
    while (pending.length) {
      const asks = pending.shift()!;
      const groupStart = now();
      const chatId = asks[0].chatId;
      const ids = asks.map((a) => a.id);
      const entry: ReplyResultEntry = {
        chat_id: chatId,
        chat_name: label(chatId),
        ask_ids: ids,
        ask_count: ids.length,
        status: "failed",
        error: null,
        text: null,
      };
      results.push(entry);

      let outcome: GroupOutcome;
      if (!chatId) {
        outcome = { status: "failed", error: "MISSING_CHAT_ID" };
      } else {
        entry.text = buildReplyMessage(asks, input.answerText);
        if (charLength(entry.text) > MAX_TEXT_LENGTH) {
          outcome = { status: "failed", error: "TEXT_TOO_LONG" };
        } else if (sent >= config.monthlyMessageLimit) {
          outcome = { status: "failed", error: "QUOTA_EXCEEDED" };
        } else {
          if (!config.allowedChatIds.includes(chatId)) {
            logger.warn("Trả lời người hỏi: nhóm không còn trong cấu hình", { batch_id: batchId, chat_id: chatId });
          }
          if (calls > 0) await sleep(SEND_GAP_MS);
          calls++;
          const r = await deps.getZaloClient().sendMessage(chatId, entry.text);
          sent++;
          await repo.recordSend(month, r.ok);
          outcome = r.ok ? { status: "sent" } : { status: "failed", error: zaloErrorText(r.error) };
        }
      }

      entry.status = outcome.status;
      entry.error = outcome.status === "failed" ? outcome.error : null;
      if (outcome.status === "sent") sentAt.set(entry, now());
      await repo.finishGroup(input.unansweredId, batchId, ids, outcome);
      if (outcome.status === "sent" && chatId && entry.text) {
        // Ghi Lịch sử lỗi thì chỉ cảnh báo: tin đã gửi, không được coi nhóm là lỗi.
        await repo
          .writeOutbound(outboundId(batchId, results.length), outboundRecord(asks, entry.text, {
            batchId, input, sentBy: caller.email ?? null, durationMs: Math.max(0, now() - groupStart),
          }))
          .catch((err: unknown) =>
            logger.warn("Trả lời người hỏi: không ghi được Lịch sử", {
              batch_id: batchId,
              chat_id: chatId,
              error: err instanceof Error ? err.message : String(err),
            }));
      }
      // R7: chat_id đích cạnh ask_id. Không ghi đáp án, tên hay token.
      logger.info("Trả lời người hỏi: kết quả gửi", {
        batch_id: batchId,
        chat_id: chatId,
        ask_ids: ids,
        status: outcome.status,
        error_code: outcome.status === "failed" ? outcome.error.split(":")[0] : null,
      });
    }
  } catch (err) {
    logger.error("Trả lời người hỏi: lỗi giữa chừng", {
      batch_id: batchId,
      error: err instanceof Error ? err.message : String(err),
    });
    // Nhóm đang dở: không biết Zalo đã nhận chưa, giữ sending (quá SENDING_STALE_MS mới gửi lại được).
    const current = results[results.length - 1];
    if (current && current.status === "failed" && current.error === null) current.error = "UNKNOWN_STATE";
    // Nhả các nhóm chưa xử lý để "Gửi lại" được.
    for (const asks of pending) {
      const ids = asks.map((a) => a.id);
      results.push({
        chat_id: asks[0].chatId,
        chat_name: label(asks[0].chatId),
        ask_ids: ids,
        ask_count: ids.length,
        status: "failed",
        error: "INTERNAL",
        text: null,
      });
      await repo.finishGroup(input.unansweredId, batchId, ids, { status: "failed", error: "INTERNAL" }).catch(() => {});
    }
  }

  // Ask bị bỏ qua (đã gửi, đã bỏ qua, đang gửi): gom theo chat_id, không gửi gì (A5).
  const skippedGroups = new Map<string, { chatId: string | null; reason: SkipReason; ids: string[] }>();
  for (const { ask, reason } of claim.skipped) {
    const key = `${ask.chatId ?? ""}|${reason}`;
    const g = skippedGroups.get(key) ?? { chatId: ask.chatId, reason, ids: [] };
    g.ids.push(ask.id);
    skippedGroups.set(key, g);
  }
  for (const g of skippedGroups.values()) {
    results.push({
      chat_id: g.chatId,
      chat_name: label(g.chatId),
      ask_ids: g.ids,
      ask_count: g.ids.length,
      status: "skipped",
      error: g.reason,
      text: null,
    });
  }

  await repo.writeBatch(batchId, {
    unanswered_id: input.unansweredId,
    kb_item_id: input.kbItemId,
    answer_text: input.answerText,
    sent_by: caller.email ?? null,
    sent_by_uid: caller.uid!,
    results: results.map((r) => ({
      chat_id: r.chat_id,
      ask_ids: r.ask_ids,
      status: r.status,
      error: r.error,
      sent_at_ms: sentAt.get(r) ?? null,
    })),
  });
  logger.info("Trả lời người hỏi: xong", {
    batch_id: batchId,
    sent: results.filter((r) => r.status === "sent").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
  });
  return { ok: true, batchId, results };
}

export type SkipResponse = HandlerError | { ok: true; skipped: string[]; unchanged: string[] };

/** Đặt `skipped` cho ask pending/failed; ask đã gửi hoặc đang gửi giữ nguyên. */
export async function handleSkipAsks(caller: Caller, data: unknown, deps: ReplyDeps): Promise<SkipResponse> {
  const denied = await checkCaller(caller, deps);
  if (denied) return denied;
  const d = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  const ids = parseIds(d);
  if ("ok" in ids) return ids;
  const r = await deps.repo.skipAsks(ids.unansweredId, ids.askIds, caller.email ?? null);
  if (!r.ok) {
    return r.reason === "unanswered_not_found"
      ? { ok: false, code: "not-found", message: "Câu hỏi không còn tồn tại." }
      : bad(`Có lượt hỏi không thuộc câu này: ${r.missing.join(", ")}`);
  }
  deps.logger.info("Trả lời người hỏi: bỏ qua", { unanswered_id: ids.unansweredId, skipped: r.skipped, unchanged: r.unchanged });
  return r;
}
