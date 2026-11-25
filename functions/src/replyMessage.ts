/**
 * Dựng tin trả lời người đã hỏi (spec trả lời người hỏi, mục 5.2). Text thuần, không parse_mode.
 *
 * Hàm thuần, không import gì: trang quản trị (admin/index.html, khối LOGIC) giữ một bản chép y hệt
 * để xem trước. Sửa một bên thì sửa cả bên kia; cả hai cùng chạy bộ mẫu
 * functions/test/fixtures/reply-message.json để bảo đảm xem trước khớp tin gửi đi.
 */

export interface ReplyAsk {
  /** Dùng để gộp tên khi một người hỏi nhiều lần; thiếu thì gộp theo tên. */
  fromId?: string | null;
  displayName: string | null;
  question: string;
  askedAtMs: number | null;
  source?: string | null;
}

export const REPLY_MAX_NAMES = 5;
export const REPLY_MAX_QUOTE_CHARS = 200;
export const REPLY_TIMEZONE = "Asia/Ho_Chi_Minh";
export const REPLY_FALLBACK_NAME = "bạn";

/** "HH:mm dd/MM" theo giờ Việt Nam. */
export function formatAskTime(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: REPLY_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("hour")}:${p("minute")} ${p("day")}/${p("month")}`;
}

/** Câu gốc trên một dòng, tối đa 200 ký tự (thêm "…" nếu cắt). */
export function quoteText(ask: ReplyAsk): string {
  const q = (ask.question ?? "").replace(/\s+/g, " ").trim();
  if (!q) return ask.source === "image" ? "[Ảnh]" : "(không có nội dung)";
  const chars = Array.from(q);
  return chars.length <= REPLY_MAX_QUOTE_CHARS ? q : chars.slice(0, REPLY_MAX_QUOTE_CHARS).join("") + "…";
}

/**
 * Tin gửi vào MỘT nhóm/chat. `asks` phải là các lượt hỏi cùng một chat_id (bên gọi gom theo chat_id).
 * Một người (kể cả hỏi nhiều lần): mẫu có giờ hỏi. Nhiều người: liệt kê tên, quá 5 thì "và N người khác".
 * Câu trích luôn là lượt hỏi gần nhất.
 */
export function buildReplyMessage(asks: ReplyAsk[], answerText: string): string {
  const answer = (answerText ?? "").trim();
  const sorted = asks
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (x.a.askedAtMs ?? 0) - (y.a.askedAtMs ?? 0) || x.i - y.i)
    .map((x) => x.a);
  const latest = sorted[sorted.length - 1];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const a of sorted) {
    const name = (a.displayName ?? "").trim() || REPLY_FALLBACK_NAME;
    const key = a.fromId ? `id:${a.fromId}` : `name:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  let header: string;
  if (names.length <= 1) {
    const when = latest && typeof latest.askedAtMs === "number" ? ` (${formatAskTime(latest.askedAtMs)})` : "";
    header = `📌 Trả lời câu hỏi của ${names[0] ?? REPLY_FALLBACK_NAME}${when}:`;
  } else {
    const shown = names.slice(0, REPLY_MAX_NAMES).join(", ");
    const more = names.length > REPLY_MAX_NAMES ? ` và ${names.length - REPLY_MAX_NAMES} người khác` : "";
    header = `📌 Trả lời câu hỏi của ${shown}${more}:`;
  }
  const quote = latest ? `"${quoteText(latest)}"` : "";
  return `${header}\n${quote}\n\n${answer}`;
}
