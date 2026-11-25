/**
 * Firestore cho chức năng trả lời người hỏi: `unanswered/{id}/asks/{askId}`, `admin_replies/{batchId}`,
 * tin đi `conversations/admin_reply_…` (Lịch sử), bộ đếm `usage/{tháng}`. Chỉ Cloud Functions ghi (Admin SDK).
 */
import { FieldValue, Firestore, Timestamp, Transaction } from "firebase-admin/firestore";
import {
  AdminReplyConversation,
  AdminReplyRecord,
  ClaimResult,
  GroupOutcome,
  ReplyRepo,
  SENDING_STALE_MS,
  SkipReason,
  StoredAsk,
  StoredAskStatus,
} from "./adminReply";
import { COLLECTIONS, CONVERSATION_TTL_MS } from "./store";

export const ADMIN_REPLIES = "admin_replies";

const STATUSES: StoredAskStatus[] = ["pending", "sent", "failed", "skipped", "sending"];

/** Timestamp của Firestore → ms; giá trị khác → null. */
function millis(v: unknown): number | null {
  const t = v as { toMillis?: () => number } | null;
  return t && typeof t.toMillis === "function" ? t.toMillis() : null;
}

const str = (v: unknown) => (typeof v === "string" ? v : null);

export function toStoredAsk(id: string, d: Record<string, unknown>): StoredAsk {
  const status = STATUSES.includes(d.reply_status as StoredAskStatus) ? (d.reply_status as StoredAskStatus) : "pending";
  return {
    id,
    chatId: str(d.chat_id) || null,
    chatType: str(d.chat_type),
    fromId: str(d.from_id),
    displayName: str(d.display_name),
    question: str(d.question) ?? "",
    askedAtMs: millis(d.asked_at),
    source: str(d.source),
    status,
  };
}

export class FirestoreReplyRepo implements ReplyRepo {
  constructor(
    private readonly db: Firestore,
    private readonly now: () => number = Date.now,
  ) {}

  private parent(id: string) {
    return this.db.collection(COLLECTIONS.unanswered).doc(id);
  }

  private async readAll(tx: Transaction,unansweredId: string, askIds: string[]) {
    const parentRef = this.parent(unansweredId);
    const parent = await tx.get(parentRef);
    const refs = askIds.map((id) => parentRef.collection(COLLECTIONS.asks).doc(id));
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    return { parentRef, parent, refs, snaps };
  }

  async claimAsks(unansweredId: string, askIds: string[], batchId: string): Promise<ClaimResult> {
    return this.db.runTransaction(async (tx) => {
      const { parent, refs, snaps } = await this.readAll(tx, unansweredId, askIds);
      if (!parent.exists) return { ok: false, reason: "unanswered_not_found", missing: [] } as const;
      const missing = askIds.filter((_, i) => !snaps[i].exists);
      if (missing.length) return { ok: false, reason: "ask_not_found", missing } as const;

      const claimed: StoredAsk[] = [];
      const skipped: { ask: StoredAsk; reason: SkipReason }[] = [];
      snaps.forEach((snap, i) => {
        const data = snap.data() as Record<string, unknown>;
        const ask = toStoredAsk(askIds[i], data);
        const sendingAt = millis(data.sending_at);
        const stale = ask.status === "sending" && sendingAt !== null && this.now() - sendingAt > SENDING_STALE_MS;
        if (ask.status === "sent") skipped.push({ ask, reason: "ALREADY_SENT" });
        else if (ask.status === "skipped") skipped.push({ ask, reason: "ALREADY_SKIPPED" });
        else if (ask.status === "sending" && !stale) skipped.push({ ask, reason: "IN_PROGRESS" });
        else {
          tx.update(refs[i], {
            reply_status: "sending",
            sending_at: Timestamp.fromMillis(this.now()),
            reply_batch_id: batchId,
          });
          claimed.push(ask);
        }
      });
      return { ok: true, claimed, skipped } as const;
    });
  }

  async finishGroup(unansweredId: string, batchId: string, askIds: string[], outcome: GroupOutcome): Promise<void> {
    const parentRef = this.parent(unansweredId);
    await this.db.runTransaction(async (tx) => {
      for (const id of askIds) {
        tx.update(parentRef.collection(COLLECTIONS.asks).doc(id), {
          reply_status: outcome.status,
          replied_at: outcome.status === "sent" ? FieldValue.serverTimestamp() : null,
          reply_error: outcome.status === "failed" ? outcome.error : null,
          reply_batch_id: batchId,
          sending_at: null,
        });
      }
      if (outcome.status === "sent") {
        tx.update(parentRef, { pending_ask_count: FieldValue.increment(-askIds.length) });
      }
    });
  }

  async writeBatch(batchId: string, record: AdminReplyRecord): Promise<void> {
    const { results, ...rest } = record;
    await this.db
      .collection(ADMIN_REPLIES)
      .doc(batchId)
      .set({
        ...rest,
        // serverTimestamp không dùng được trong mảng.
        results: results.map(({ sent_at_ms, ...r }) => ({
          ...r,
          sent_at: sent_at_ms === null ? null : Timestamp.fromMillis(sent_at_ms),
        })),
        created_at: FieldValue.serverTimestamp(),
      });
  }

  async writeOutbound(id: string, record: AdminReplyConversation): Promise<void> {
    await this.db
      .collection(COLLECTIONS.conversations)
      .doc(id)
      .set({
        ...record,
        created_at: FieldValue.serverTimestamp(),
        expire_at: Timestamp.fromMillis(this.now() + CONVERSATION_TTL_MS),
      });
  }

  async getMonthlySent(month: string): Promise<number> {
    const snap = await this.db.collection(COLLECTIONS.usage).doc(month).get();
    const v = snap.exists ? snap.get("messages_sent") : 0;
    return typeof v === "number" ? v : 0;
  }

  async recordSend(month: string, ok: boolean): Promise<void> {
    await this.db.collection(COLLECTIONS.usage).doc(month).set(
      {
        messages_sent: FieldValue.increment(1),
        ...(ok
          ? { admin_replies_sent: FieldValue.increment(1) }
          : { send_errors: FieldValue.increment(1), admin_reply_errors: FieldValue.increment(1) }),
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  async skipAsks(unansweredId: string, askIds: string[], by: string | null): ReturnType<ReplyRepo["skipAsks"]> {
    return this.db.runTransaction(async (tx): ReturnType<ReplyRepo["skipAsks"]> => {
      const { parentRef, parent, refs, snaps } = await this.readAll(tx, unansweredId, askIds);
      if (!parent.exists) return { ok: false, reason: "unanswered_not_found", missing: [] } as const;
      const missing = askIds.filter((_, i) => !snaps[i].exists);
      if (missing.length) return { ok: false, reason: "ask_not_found", missing } as const;
      const skipped: string[] = [];
      const unchanged: string[] = [];
      snaps.forEach((snap, i) => {
        const status = toStoredAsk(askIds[i], snap.data() as Record<string, unknown>).status;
        if (status === "pending" || status === "failed") {
          tx.update(refs[i], {
            reply_status: "skipped",
            reply_error: null,
            skipped_by: by,
            skipped_at: FieldValue.serverTimestamp(),
          });
          skipped.push(askIds[i]);
        } else {
          unchanged.push(askIds[i]);
        }
      });
      if (skipped.length) tx.update(parentRef, { pending_ask_count: FieldValue.increment(-skipped.length) });
      return { ok: true, skipped, unchanged } as const;
    });
  }
}
