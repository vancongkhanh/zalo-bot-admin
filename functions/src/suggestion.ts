/**
 * Thêm câu người dùng đã hỏi vào "Các cách hỏi" (`kb_items.questions`) của một mục,
 * từ tab Lịch sử (docs/spec-them-cau-hoi-goi-y.md).
 *
 * Hàm thuần: quyết định dựa trên dữ liệu đã đọc; kho dữ liệu, kiểm tra quyền được truyền vào để kiểm thử.
 * Đã chốt: giới hạn cứng 50 câu mỗi mục; câu có thông tin cá nhân thì không lưu;
 * mục đã duyệt giữ nguyên approved_by/approved_at; so trùng giữ dấu tiếng Việt.
 */
import { stripMention } from "./mention";

export const SUGGESTION_MIN_CHARS = 5;
export const SUGGESTION_MAX_CHARS = 300;
/** Trùng giới hạn của Rules, trang quản trị và suggest.ts. */
export const MAX_ITEM_QUESTIONS = 50;
/** Chữ trang quản trị thay cho phần thông tin cá nhân đã ẩn. */
export const PII_MASK = "[đã ẩn]";
const PII_OPEN = "⟦";
const PII_CLOSE = "⟧";

const DOC_ID = /^(?!\.\.?$)[^/]{1,200}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Cùng mẫu với trang quản trị (PII_PATTERNS): email, số điện thoại, CCCD 12 số. */
const PII_PATTERNS = [
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/,
  /(?<![\d+])(?:\+84|0)(?:[ .-]?\d){9,10}(?!\d)/,
  /(?<!\d)\d{12}(?!\d)/,
];

const charLength = (s: string) => Array.from(s).length;

/** Câu sẽ lưu: bỏ @tên bot, gộp mọi khoảng trắng (kể cả xuống dòng) thành một dấu cách, trim. */
export function cleanSuggestion(text: string, botName: string | null): string {
  const t = (text ?? "").normalize("NFC");
  const noMention = botName?.trim() ? stripMention(t, botName).text : t;
  return noMention.replace(/\s+/g, " ").trim();
}

/** Chuỗi so trùng: chữ thường, bỏ dấu câu, gộp khoảng trắng; GIỮ dấu tiếng Việt. */
export function normalizeSuggestion(text: string): string {
  return (text ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Còn thông tin cá nhân: phần đã ẩn, dấu bọc ⟦⟧ của AI, hoặc khớp mẫu số điện thoại/CCCD/email. */
export function hasPersonalInfo(text: string): boolean {
  const s = text ?? "";
  if (s.includes(PII_MASK) || s.includes(PII_OPEN) || s.includes(PII_CLOSE)) return true;
  return PII_PATTERNS.some((re) => re.test(s));
}

// ---------- Input ----------

type ErrCode = "unauthenticated" | "permission-denied" | "invalid-argument" | "not-found" | "failed-precondition";
export type HandlerError = { ok: false; code: ErrCode; message: string };
const bad = (message: string): HandlerError => ({ ok: false, code: "invalid-argument", message });

export interface SuggestionInput {
  historyId: string;
  kbItemId: string;
  /** Đã làm sạch (cleanSuggestion). */
  question: string;
  /** Xác nhận lần 2 khi câu đang là gợi ý của mục khác. */
  force: boolean;
}

/** Chỉ đọc 4 trường; trường khác bị bỏ qua. */
export function parseSuggestionInput(data: unknown, botName: string | null): SuggestionInput | HandlerError {
  const d = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  if (typeof d.historyId !== "string" || !DOC_ID.test(d.historyId)) return bad("historyId không hợp lệ.");
  if (typeof d.kbItemId !== "string" || !SLUG.test(d.kbItemId) || d.kbItemId.length > 80) {
    return bad("kbItemId không hợp lệ.");
  }
  if (typeof d.question !== "string") return bad("Câu hỏi đang trống.");
  const question = cleanSuggestion(d.question, botName);
  const n = charLength(question);
  if (n < SUGGESTION_MIN_CHARS || n > SUGGESTION_MAX_CHARS) {
    return bad(`Câu phải dài ${SUGGESTION_MIN_CHARS}–${SUGGESTION_MAX_CHARS} ký tự (đang có ${n}).`);
  }
  if (hasPersonalInfo(question)) {
    return bad("Câu còn thông tin cá nhân (số điện thoại, CCCD, email hoặc phần đã ẩn). Xóa đi trước khi lưu.");
  }
  if (d.force !== undefined && typeof d.force !== "boolean") return bad("force không hợp lệ.");
  return { historyId: d.historyId, kbItemId: d.kbItemId, question, force: d.force === true };
}

// ---------- Quyết định (thuần) ----------

export interface HistoryDoc {
  outcome?: unknown;
  matched_slug?: unknown;
  send_ok?: unknown;
  question?: unknown;
  confidence?: unknown;
  suggestion_added_at?: unknown;
  suggestion_kb_item_id?: unknown;
}

export interface KbDoc {
  slug: string;
  title?: unknown;
  status?: unknown;
  questions?: unknown;
  version?: unknown;
}

/** Bản ghi Lịch sử "Trả lời được" bằng một mục kho, có câu chữ. */
export function historyEligible(h: HistoryDoc): boolean {
  return (
    (h.outcome === "answered" || h.outcome === "replied") &&
    typeof h.matched_slug === "string" &&
    h.matched_slug !== "" &&
    h.send_ok !== false &&
    typeof h.question === "string" &&
    h.question.trim() !== ""
  );
}

const questionsOf = (d: KbDoc | null): string[] =>
  Array.isArray(d?.questions) ? (d!.questions as unknown[]).filter((q): q is string => typeof q === "string") : [];

export interface OtherItem {
  slug: string;
  title: string;
  status: string | null;
}

export type Decision =
  | { status: "history_not_found" }
  | { status: "history_not_eligible" }
  | { status: "already_added"; kbItemId: string | null }
  | { status: "item_not_found" }
  | { status: "item_not_approved" }
  | { status: "duplicate_same" }
  | { status: "full"; count: number }
  | { status: "duplicate_other"; others: OtherItem[] }
  | { status: "add"; questions: string[]; version: number; itemChanged: boolean; otherSlug: string | null };

/**
 * Thứ tự kiểm tra: bản ghi Lịch sử → đã thêm từ bản ghi này → mục đích → trùng trong mục →
 * mục đủ 50 câu → trùng ở mục khác (trừ khi force) → thêm.
 */
export function decideSuggestion(
  input: SuggestionInput,
  history: HistoryDoc | null,
  target: KbDoc | null,
  allItems: KbDoc[],
): Decision {
  if (!history) return { status: "history_not_found" };
  if (!historyEligible(history)) return { status: "history_not_eligible" };
  if (history.suggestion_added_at !== undefined && history.suggestion_added_at !== null) {
    return {
      status: "already_added",
      kbItemId: typeof history.suggestion_kb_item_id === "string" ? history.suggestion_kb_item_id : null,
    };
  }
  if (!target) return { status: "item_not_found" };
  if (target.status !== "approved") return { status: "item_not_approved" };

  const key = normalizeSuggestion(input.question);
  const current = questionsOf(target);
  if (current.some((q) => normalizeSuggestion(q) === key)) return { status: "duplicate_same" };
  if (current.length >= MAX_ITEM_QUESTIONS) return { status: "full", count: current.length };

  const others: OtherItem[] = allItems
    .filter((d) => d.slug !== target.slug && questionsOf(d).some((q) => normalizeSuggestion(q) === key))
    .map((d) => ({
      slug: d.slug,
      title: typeof d.title === "string" && d.title ? d.title : d.slug,
      status: typeof d.status === "string" ? d.status : null,
    }));
  if (others.length && !input.force) return { status: "duplicate_other", others };

  return {
    status: "add",
    questions: [...current, input.question],
    version: (Number.isInteger(target.version) ? (target.version as number) : 0) + 1,
    itemChanged: input.kbItemId !== history.matched_slug,
    otherSlug: others[0]?.slug ?? null,
  };
}

// ---------- Handler ----------

export interface SuggestionLog {
  kb_item_id: string;
  question: string;
  original_text: string;
  history_ref: string;
  confidence: number | null;
  item_changed: boolean;
  duplicate_in_other_item: string | null;
  added_by: string | null;
  added_by_uid: string;
}

export interface SuggestionRepo {
  /**
   * Một transaction: đọc bản ghi Lịch sử, mục đích, mọi mục; gọi decide; ghi theo kết quả
   * ("add": mục + log + đánh dấu Lịch sử; "duplicate_same": chỉ đánh dấu Lịch sử).
   */
  apply(
    input: SuggestionInput,
    caller: { email: string | null; uid: string },
    decide: (history: HistoryDoc | null, target: KbDoc | null, all: KbDoc[]) => Decision,
  ): Promise<Decision>;
}

export interface SuggestionDeps {
  isAdmin(uid: string): Promise<boolean>;
  getBotName(): Promise<string | null>;
  repo: SuggestionRepo;
  logger: { info(m: string, d?: Record<string, unknown>): void };
}

export interface Caller {
  uid?: string;
  email?: string | null;
}

export type SuggestionResponse =
  | HandlerError
  | { ok: true; status: "added"; kbItemId: string; questionCount: number; itemChanged: boolean }
  | { ok: true; status: "duplicate_same"; kbItemId: string }
  | { ok: true; status: "already_added"; kbItemId: string | null }
  | { ok: true; status: "duplicate_other"; others: OtherItem[] };

export async function handleAddSuggestion(
  caller: Caller,
  data: unknown,
  deps: SuggestionDeps,
): Promise<SuggestionResponse> {
  if (!caller.uid) return { ok: false, code: "unauthenticated", message: "Cần đăng nhập." };
  if (!(await deps.isAdmin(caller.uid))) {
    return { ok: false, code: "permission-denied", message: "Tài khoản chưa có quyền quản trị." };
  }
  const input = parseSuggestionInput(data, await deps.getBotName());
  if ("ok" in input) return input;

  const r = await deps.repo.apply(input, { email: caller.email ?? null, uid: caller.uid }, (h, t, all) =>
    decideSuggestion(input, h, t, all),
  );
  // Không ghi nội dung câu vào log (có thể chứa thông tin người dùng).
  deps.logger.info("Thêm câu gợi ý", { history_id: input.historyId, kb_item_id: input.kbItemId, status: r.status });

  switch (r.status) {
    case "history_not_found":
      return { ok: false, code: "not-found", message: "Bản ghi Lịch sử không còn (nhật ký giữ 90 ngày)." };
    case "history_not_eligible":
      return { ok: false, code: "failed-precondition", message: "Chỉ thêm được từ lượt bot trả lời được bằng một mục kho." };
    case "item_not_found":
      return { ok: false, code: "not-found", message: "Mục kho không còn tồn tại." };
    case "item_not_approved":
      return { ok: false, code: "failed-precondition", message: "Mục kho chưa ở trạng thái Đã duyệt." };
    case "full":
      return {
        ok: false,
        code: "failed-precondition",
        message: `Mục đã đủ ${MAX_ITEM_QUESTIONS} cách hỏi. Xóa bớt ở tab Kho tri thức trước khi thêm.`,
      };
    case "already_added":
      return { ok: true, status: "already_added", kbItemId: r.kbItemId };
    case "duplicate_same":
      return { ok: true, status: "duplicate_same", kbItemId: input.kbItemId };
    case "duplicate_other":
      return { ok: true, status: "duplicate_other", others: r.others };
    case "add":
      return {
        ok: true,
        status: "added",
        kbItemId: input.kbItemId,
        questionCount: r.questions.length,
        itemChanged: r.itemChanged,
      };
  }
}
