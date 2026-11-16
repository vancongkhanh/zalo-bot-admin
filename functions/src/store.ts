/**
 * Lớp lưu trữ Firestore (spec giai đoạn 1, mục 4 và 5).
 *
 * - `config/main`: cấu hình, bạn tự điền.
 * - `processed_events/{message_id}`: chống trùng; `expire_at` (7 ngày) có chính sách TTL.
 * - `conversations/{message_id}`: nhật ký hội thoại; không lưu token hay header.
 * - `usage/{YYYY-MM}`: `messages_sent`, `send_errors` (FieldValue.increment).
 */
import { FieldValue, Firestore, Timestamp } from "firebase-admin/firestore";
import { BotConfig, parseConfig } from "./config";
import { KbItem, MAX_SAMPLES, toKbItem } from "./kb";

export type EventState = "processing" | "done" | "failed";
/** replied: trả lời kiểu giai đoạn 1; answered/handoff: bước C. */
export type Outcome = "replied" | "ignored" | "error" | "answered" | "handoff";
export type HandoffReason = "no_match" | "low_confidence" | "ai_error" | "ai_quota";

export interface ConversationRecord {
  chat_id: string | null;
  from_id: string | null;
  display_name: string | null;
  /** Nội dung sau khi cắt @; null với sự kiện bị bỏ qua trước khi đọc nội dung. */
  question: string | null;
  reply_text: string | null;
  outcome: Outcome;
  ignore_reason: string | null;
  /** Mô tả lỗi gửi tin (đã che token); null nếu không lỗi. */
  error: string | null;
  duration_ms: number;
  // Bước C (chỉ có khi đi qua luồng AI)
  matched_slug?: string | null;
  confidence?: number | null;
  reason?: HandoffReason | null;
  ai_ms?: number | null;
  /** Kết quả gửi khi outcome là answered/handoff mà gửi lỗi. */
  send_ok?: boolean;
  // Bước E (chỉ có khi mục trả lời có ảnh)
  images_sent?: number;
  image_errors?: number;
  images_as_links?: number;
}

export interface AiCallRecord {
  ok: boolean;
  inputTokens: number;
  outputTokens: number;
}

export interface DailyStat {
  outcome: "answered" | "handoff";
  aiError: boolean;
  slug: string | null;
  /** Bước E: số ảnh gửi thành công. */
  photosSent?: number;
}

export interface UnansweredInput {
  id: string;
  clusterKey: string;
  sample: string;
  reason: HandoffReason;
  bestGuessSlug: string | null;
  bestGuessConfidence: number | null;
}

export interface Store {
  getConfig(): Promise<{ config: BotConfig; warnings: string[] }>;
  /** Tạo `processed_events/{messageId}` (state=processing). Trả false nếu đã tồn tại. */
  claimEvent(messageId: string): Promise<boolean>;
  setEventState(messageId: string, state: Exclude<EventState, "processing">): Promise<void>;
  /** `usage/{month}.messages_sent` (0 nếu chưa có). */
  getMonthlySent(month: string): Promise<number>;
  /** Tăng `messages_sent` thêm 1 (FieldValue.increment). */
  recordSendSuccess(month: string): Promise<void>;
  recordSendError(month: string): Promise<void>;
  /** Bước E: mỗi lần gọi sendPhoto tăng `messages_sent`, kể cả lỗi; thêm `photos_sent` hoặc `photo_errors`. */
  recordPhotoSend(month: string, ok: boolean): Promise<void>;
  /** Đánh dấu đã cảnh báo 80% trong tháng; trả true nếu đây là lần đầu. */
  markQuotaWarning(month: string): Promise<boolean>;
  /** Ghi `conversations/{messageId}`; store tự thêm `created_at`. */
  writeConversation(messageId: string, record: ConversationRecord): Promise<void>;

  // Bước C
  /** Các mục `approved` (cache 60 giây trong bộ nhớ hàm). */
  getApprovedItems(): Promise<KbItem[]>;
  /** `usage/{month}.ai_calls` (0 nếu chưa có). */
  getMonthlyAiCalls(month: string): Promise<number>;
  recordAiCall(month: string, call: AiCallRecord): Promise<void>;
  /** `stats_daily/{day}`: questions, answered/handoff, ai_errors, item_hits.{slug}. */
  recordDailyStat(day: string, stat: DailyStat): Promise<void>;
  /** Tăng `hit_count`, cập nhật `last_hit_at` của mục. */
  recordHit(slug: string): Promise<void>;
  /** Ghi hoặc gộp vào `unanswered/{id}` (count tăng nguyên tử). */
  recordUnanswered(input: UnansweredInput): Promise<void>;
}

export const COLLECTIONS = {
  config: "config",
  events: "processed_events",
  conversations: "conversations",
  usage: "usage",
  kb: "kb_items",
  statsDaily: "stats_daily",
  unanswered: "unanswered",
} as const;

export const KB_CACHE_MS = 60 * 1000;
export const CONVERSATION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export const CONFIG_DOC = "main";
export const EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Mã gRPC ALREADY_EXISTS mà Firestore trả khi `create()` gặp tài liệu đã có. */
const GRPC_ALREADY_EXISTS = 6;

function isAlreadyExists(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown };
  return (
    e?.code === GRPC_ALREADY_EXISTS ||
    e?.code === "already-exists" ||
    e?.code === "ALREADY_EXISTS" ||
    (typeof e?.message === "string" && e.message.includes("ALREADY_EXISTS"))
  );
}

export class FirestoreStore implements Store {
  private kbCache: { at: number; items: KbItem[] } | null = null;

  constructor(
    private readonly db: Firestore,
    private readonly now: () => number = Date.now,
  ) {}

  async getConfig() {
    const snap = await this.db.collection(COLLECTIONS.config).doc(CONFIG_DOC).get();
    return parseConfig(snap.exists ? (snap.data() as Record<string, unknown>) : undefined);
  }

  async claimEvent(messageId: string): Promise<boolean> {
    try {
      await this.db
        .collection(COLLECTIONS.events)
        .doc(messageId)
        .create({
          received_at: FieldValue.serverTimestamp(),
          state: "processing",
          expire_at: Timestamp.fromMillis(this.now() + EVENT_TTL_MS),
        });
      return true;
    } catch (err) {
      if (isAlreadyExists(err)) return false;
      throw err;
    }
  }

  async setEventState(messageId: string, state: "done" | "failed"): Promise<void> {
    await this.db.collection(COLLECTIONS.events).doc(messageId).update({
      state,
      updated_at: FieldValue.serverTimestamp(),
    });
  }

  async getMonthlySent(month: string): Promise<number> {
    const snap = await this.db.collection(COLLECTIONS.usage).doc(month).get();
    const v = snap.exists ? snap.get("messages_sent") : 0;
    return typeof v === "number" ? v : 0;
  }

  async recordSendSuccess(month: string): Promise<void> {
    await this.db.collection(COLLECTIONS.usage).doc(month).set(
      { messages_sent: FieldValue.increment(1), updated_at: FieldValue.serverTimestamp() },
      { merge: true },
    );
  }

  /** Quyết định 3 (bước C): `messages_sent` đếm cả lần gửi lỗi. */
  async recordSendError(month: string): Promise<void> {
    await this.db.collection(COLLECTIONS.usage).doc(month).set(
      {
        messages_sent: FieldValue.increment(1),
        send_errors: FieldValue.increment(1),
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  async recordPhotoSend(month: string, ok: boolean): Promise<void> {
    await this.db.collection(COLLECTIONS.usage).doc(month).set(
      {
        messages_sent: FieldValue.increment(1),
        [ok ? "photos_sent" : "photo_errors"]: FieldValue.increment(1),
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  async markQuotaWarning(month: string): Promise<boolean> {
    const ref = this.db.collection(COLLECTIONS.usage).doc(month);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && snap.get("quota_warning_sent") === true) return false;
      tx.set(
        ref,
        { quota_warning_sent: true, quota_warning_at: FieldValue.serverTimestamp() },
        { merge: true },
      );
      return true;
    });
  }

  async writeConversation(messageId: string, record: ConversationRecord): Promise<void> {
    await this.db
      .collection(COLLECTIONS.conversations)
      .doc(messageId)
      .set({
        ...record,
        created_at: FieldValue.serverTimestamp(),
        expire_at: Timestamp.fromMillis(this.now() + CONVERSATION_TTL_MS),
      });
  }

  async getApprovedItems(): Promise<KbItem[]> {
    const t = this.now();
    if (this.kbCache && t - this.kbCache.at < KB_CACHE_MS) return this.kbCache.items;
    const snap = await this.db.collection(COLLECTIONS.kb).where("status", "==", "approved").get();
    const items = snap.docs
      .map((d) => toKbItem(d.id, d.data() as Record<string, unknown>))
      .filter((x): x is KbItem => x !== null)
      .sort((a, b) => a.slug.localeCompare(b.slug)); // thứ tự cố định để cache lời gọi AI
    this.kbCache = { at: t, items };
    return items;
  }

  async getMonthlyAiCalls(month: string): Promise<number> {
    const snap = await this.db.collection(COLLECTIONS.usage).doc(month).get();
    const v = snap.exists ? snap.get("ai_calls") : 0;
    return typeof v === "number" ? v : 0;
  }

  async recordAiCall(month: string, call: AiCallRecord): Promise<void> {
    await this.db
      .collection(COLLECTIONS.usage)
      .doc(month)
      .set(
        {
          ai_calls: FieldValue.increment(1),
          ai_errors: FieldValue.increment(call.ok ? 0 : 1),
          ai_input_tokens: FieldValue.increment(call.inputTokens),
          ai_output_tokens: FieldValue.increment(call.outputTokens),
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  }

  async recordDailyStat(day: string, stat: DailyStat): Promise<void> {
    const data: Record<string, unknown> = {
      questions: FieldValue.increment(1),
      [stat.outcome]: FieldValue.increment(1),
      updated_at: FieldValue.serverTimestamp(),
    };
    if (stat.aiError) data.ai_errors = FieldValue.increment(1);
    if (stat.photosSent) data.photos_sent = FieldValue.increment(stat.photosSent);
    if (stat.slug) data.item_hits = { [stat.slug]: FieldValue.increment(1) };
    await this.db.collection(COLLECTIONS.statsDaily).doc(day).set(data, { merge: true });
  }

  async recordHit(slug: string): Promise<void> {
    await this.db.collection(COLLECTIONS.kb).doc(slug).update({
      hit_count: FieldValue.increment(1),
      last_hit_at: FieldValue.serverTimestamp(),
    });
  }

  async recordUnanswered(input: UnansweredInput): Promise<void> {
    const ref = this.db.collection(COLLECTIONS.unanswered).doc(input.id);
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const base = {
        last_asked_at: FieldValue.serverTimestamp(),
        reason: input.reason,
        best_guess_slug: input.bestGuessSlug,
        best_guess_confidence: input.bestGuessConfidence,
      };
      if (!snap.exists) {
        tx.create(ref, {
          ...base,
          cluster_key: input.clusterKey,
          samples: [input.sample],
          count: 1,
          first_asked_at: FieldValue.serverTimestamp(),
          status: "new",
          answered_slug: null,
          answered_at: null,
        });
        return;
      }
      const samples = (snap.get("samples") as unknown[] | undefined)?.filter((x) => typeof x === "string") ?? [];
      const update: Record<string, unknown> = { ...base, count: FieldValue.increment(1) };
      if (samples.length < MAX_SAMPLES && !samples.includes(input.sample)) {
        update.samples = FieldValue.arrayUnion(input.sample);
      }
      // Câu đã answered/ignored mà vẫn phải chuyển ca: đưa về new (mục 4.4).
      if (snap.get("status") !== "new") update.status = "new";
      tx.update(ref, update);
    });
  }
}
