/**
 * Cắt phần "@{tên bot}" khỏi tin nhắn.
 *
 * - Không phân biệt hoa thường (kể cả chữ có dấu như Đ/đ).
 * - Chấp nhận khoảng trắng thừa: sau "@", và giữa các từ trong tên bot.
 * - Cắt mọi lần xuất hiện, ở bất kỳ vị trí nào; sau đó gộp khoảng trắng thừa
 *   và cắt khoảng trắng hai đầu.
 * - Chuẩn hóa Unicode NFC cho cả tin nhắn và tên bot (chữ có dấu có thể đến
 *   ở dạng tổ hợp NFD).
 */

export interface MentionResult {
  /** Nội dung sau khi cắt @tên bot. */
  text: string;
  /** Tin nhắn có chứa @tên bot hay không. */
  hadMention: boolean;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildMentionRegex(botName: string): RegExp {
  const words = botName.normalize("NFC").trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (words.length === 0) throw new Error("bot_mention_name rỗng");
  // Sau từ cuối không được dính liền chữ/số (tránh cắt "@Bot TTHC Đảngabc").
  return new RegExp(`@\\s*${words.join("\\s+")}(?![\\p{L}\\p{N}])`, "giu");
}

export function stripMention(text: string, botName: string): MentionResult {
  const normalized = (text ?? "").normalize("NFC");
  const re = buildMentionRegex(botName);
  let hadMention = false;
  const replaced = normalized.replace(re, () => {
    hadMention = true;
    return " ";
  });
  const cleaned = replaced
    .replace(/[^\S\r\n]+/g, " ") // gộp khoảng trắng (không gộp xuống dòng)
    .replace(/ *\n */g, "\n")
    .trim();
  return { text: cleaned, hadMention };
}
