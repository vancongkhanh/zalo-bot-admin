/**
 * Kho tri thức (bước C): kiểu mục, ghép câu trả lời, chuẩn hóa câu hỏi cho `unanswered`.
 */
import { createHash } from "node:crypto";
import { MAX_TEXT_LENGTH } from "./zaloClient";

export interface KbLink {
  label: string;
  url: string;
}

/** Phần của `kb_items/{slug}` mà bot dùng. Chỉ mục `approved` được nạp. */
export interface KbItem {
  slug: string;
  title: string;
  questions: string[];
  answer: string;
  links: KbLink[];
}

/** Đọc một tài liệu Firestore thành KbItem; trả null nếu thiếu trường bắt buộc. */
export function toKbItem(slug: string, data: Record<string, unknown>): KbItem | null {
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const answer = typeof data.answer === "string" ? data.answer.trim() : "";
  if (!slug || !title || !answer) return null;
  const questions = Array.isArray(data.questions)
    ? data.questions.filter((q): q is string => typeof q === "string" && q.trim() !== "").map((q) => q.trim())
    : [];
  const links = Array.isArray(data.links)
    ? data.links.flatMap((l) => {
        const o = l as Record<string, unknown> | null;
        const url = typeof o?.url === "string" ? o.url.trim() : "";
        if (!url.startsWith("https://")) return [];
        const label = typeof o?.label === "string" && o.label.trim() ? o.label.trim() : "Liên kết";
        return [{ label, url }];
      })
    : [];
  return { slug, title, questions, answer, links };
}

const charLen = (s: string) => Array.from(s).length;

/**
 * Nội dung gửi: nguyên văn `answer`, rồi mỗi link một dòng `Nhãn: URL`.
 * Quá 2.000 ký tự thì bỏ bớt link từ cuối; `droppedLinks` > 0 để ghi cảnh báo.
 */
export function buildAnswerText(item: KbItem, max = MAX_TEXT_LENGTH): { text: string; droppedLinks: number } {
  const lines = item.links.map((l) => `${l.label}: ${l.url}`);
  for (let keep = lines.length; keep >= 0; keep--) {
    const text = keep > 0 ? `${item.answer}\n\n${lines.slice(0, keep).join("\n")}` : item.answer;
    if (charLen(text) <= max) return { text, droppedLinks: lines.length - keep };
  }
  // `answer` đã giới hạn 1.500 ký tự khi nạp; đây chỉ là chốt chặn.
  return { text: Array.from(item.answer).slice(0, max).join(""), droppedLinks: lines.length };
}

/** Câu hỏi đã chuẩn hóa: chữ thường, bỏ dấu, bỏ ký tự thừa, gộp khoảng trắng. */
export function clusterKey(question: string): string {
  return question
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Mã tài liệu `unanswered`: băm SHA-256 của cluster_key (32 ký tự hex). */
export function unansweredId(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex").slice(0, 32);
}

export const MAX_SAMPLE_CHARS = 300;
export const MAX_SAMPLES = 3;

export function sampleText(question: string): string {
  return Array.from(question.trim()).slice(0, MAX_SAMPLE_CHARS).join("");
}
