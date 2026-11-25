/**
 * Firestore cho "Thêm vào câu gợi ý": `kb_items/{slug}.questions`, `kb_suggestion_log/{autoId}`,
 * đánh dấu `conversations/{id}`. Chỉ Cloud Functions ghi (Admin SDK), trong MỘT transaction.
 */
import { FieldValue, Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "./store";
import type { Decision, HistoryDoc, KbDoc, SuggestionInput, SuggestionLog, SuggestionRepo } from "./suggestion";

export const KB_SUGGESTION_LOG = "kb_suggestion_log";

export class FirestoreSuggestionRepo implements SuggestionRepo {
  constructor(private readonly db: Firestore) {}

  async apply(
    input: SuggestionInput,
    caller: { email: string | null; uid: string },
    decide: (history: HistoryDoc | null, target: KbDoc | null, all: KbDoc[]) => Decision,
  ): Promise<Decision> {
    const historyRef = this.db.collection(COLLECTIONS.conversations).doc(input.historyId);
    const kb = this.db.collection(COLLECTIONS.kb);
    const targetRef = kb.doc(input.kbItemId);
    return this.db.runTransaction(async (tx) => {
      // Mọi lần đọc trước mọi lần ghi. Kho chỉ vài trăm mục nên đọc hết để so trùng ở mục khác.
      const historySnap = await tx.get(historyRef);
      const itemsSnap = await tx.get(kb);
      const all: KbDoc[] = itemsSnap.docs.map((d) => ({ slug: d.id, ...(d.data() as Omit<KbDoc, "slug">) }));
      const history = historySnap.exists ? (historySnap.data() as HistoryDoc) : null;
      const target = all.find((d) => d.slug === input.kbItemId) ?? null;

      const decision = decide(history, target, all);
      const mark = { suggestion_added_at: FieldValue.serverTimestamp(), suggestion_kb_item_id: input.kbItemId };

      if (decision.status === "duplicate_same") {
        tx.update(historyRef, mark);
      } else if (decision.status === "add") {
        // Giữ nguyên status, approved_by, approved_at (chỉ thêm một cách hỏi, không đổi nội dung trả lời).
        tx.update(targetRef, {
          questions: decision.questions,
          version: decision.version,
          updated_at: FieldValue.serverTimestamp(),
          updated_by: caller.email,
        });
        const log: SuggestionLog = {
          kb_item_id: input.kbItemId,
          question: input.question,
          original_text: typeof history?.question === "string" ? history.question : "",
          history_ref: input.historyId,
          confidence: typeof history?.confidence === "number" ? history.confidence : null,
          item_changed: decision.itemChanged,
          duplicate_in_other_item: decision.otherSlug,
          added_by: caller.email,
          added_by_uid: caller.uid,
        };
        tx.create(this.db.collection(KB_SUGGESTION_LOG).doc(), { ...log, added_at: FieldValue.serverTimestamp() });
        tx.update(historyRef, mark);
      }
      return decision;
    });
  }
}
