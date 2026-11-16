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

export type EventState = "processing" | "done" | "failed";
export type Outcome = "replied" | "ignored" | "error";

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
  /** Đánh dấu đã cảnh báo 80% trong tháng; trả true nếu đây là lần đầu. */
  markQuotaWarning(month: string): Promise<boolean>;
  /** Ghi `conversations/{messageId}`; store tự thêm `created_at`. */
  writeConversation(messageId: string, record: ConversationRecord): Promise<void>;
}

export const COLLECTIONS = {
  config: "config",
  events: "processed_events",
  conversations: "conversations",
  usage: "usage",
} as const;

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

  async recordSendError(month: string): Promise<void> {
    await this.db.collection(COLLECTIONS.usage).doc(month).set(
      { send_errors: FieldValue.increment(1), updated_at: FieldValue.serverTimestamp() },
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
      .set({ ...record, created_at: FieldValue.serverTimestamp() });
  }
}
