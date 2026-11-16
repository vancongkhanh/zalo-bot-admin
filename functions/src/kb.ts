/**
 * Kho tri thức (bước C): kiểu mục, ghép câu trả lời, chuẩn hóa câu hỏi cho `unanswered`.
 */
import { createHash } from "node:crypto";
import { MAX_TEXT_LENGTH } from "./zaloClient";

export interface KbLink {
  label: string;
  url: string;
}

/** Bước E: ảnh minh họa của mục (Firebase Storage, link tải có token). */
export interface KbImage {
  url: string;
  /** Chú thích riêng; trống thì bot tự đặt "Bước i/n". */
  caption: string;
}

/** Phần của `kb_items/{slug}` mà bot dùng. Chỉ mục `approved` được nạp. */
export interface KbItem {
  slug: string;
  title: string;
  questions: string[];
  answer: string;
  links: KbLink[];
  /** Thứ tự trong mảng là thứ tự gửi. Thiếu = không có ảnh. */
  images?: KbImage[];
}

export const MAX_ITEM_IMAGES = 10;
export const MAX_CAPTION_CHARS = 200;

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
  const images = Array.isArray(data.images)
    ? data.images
        .flatMap((im) => {
          const o = im as Record<string, unknown> | null;
          const url = typeof o?.url === "string" ? o.url.trim() : "";
          if (!url.startsWith("https://")) return [];
          const raw = typeof o?.caption === "string" ? o.caption.trim() : "";
          const caption = Array.from(raw).slice(0, MAX_CAPTION_CHARS).join("");
          return [{ url, caption }];
        })
        .slice(0, MAX_ITEM_IMAGES)
    : [];
  return { slug, title, questions, answer, links, images };
}

const charLen = (s: string) => Array.from(s).length;

/** Ảnh không gửi thẳng mà đưa thành link trong tin chữ; `index` tính từ 1. */
export interface ImageLink {
  index: number;
  url: string;
}

export interface AnswerText {
  text: string;
  droppedLinks: number;
  /** Link ảnh bị bỏ vì tin quá dài (bước E). */
  droppedImageLinks: number;
}

/**
 * Nội dung gửi: nguyên văn `answer`, rồi mỗi link một dòng `Nhãn: URL`,
 * rồi các ảnh thành link, mỗi ảnh một dòng `Ảnh i: URL` (bước E).
 * Quá 2.000 ký tự thì bỏ link ảnh từ cuối trước, rồi link thường từ cuối.
 */
export function buildAnswerText(item: KbItem, max = MAX_TEXT_LENGTH, imageLinks: ImageLink[] = []): AnswerText {
  const lines = item.links.map((l) => `${l.label}: ${l.url}`);
  const imageLines = imageLinks.map((l) => `Ảnh ${l.index}: ${l.url}`);
  const compose = (keepLinks: number, keepImages: number) => {
    const blocks = [item.answer];
    if (keepLinks > 0) blocks.push(lines.slice(0, keepLinks).join("\n"));
    if (keepImages > 0) blocks.push(imageLines.slice(0, keepImages).join("\n"));
    return blocks.join("\n\n");
  };
  for (let keepImages = imageLines.length; keepImages >= 0; keepImages--) {
    const text = compose(lines.length, keepImages);
    if (charLen(text) <= max) {
      return { text, droppedLinks: 0, droppedImageLinks: imageLines.length - keepImages };
    }
  }
  for (let keep = lines.length - 1; keep >= 0; keep--) {
    const text = compose(keep, 0);
    if (charLen(text) <= max) {
      return { text, droppedLinks: lines.length - keep, droppedImageLinks: imageLines.length };
    }
  }
  // `answer` đã giới hạn 1.500 ký tự khi nạp; đây chỉ là chốt chặn.
  return {
    text: Array.from(item.answer).slice(0, max).join(""),
    droppedLinks: lines.length,
    droppedImageLinks: imageLines.length,
  };
}

/** Ảnh sẽ gửi bằng `sendPhoto`, kèm chú thích đã chốt. */
export interface PhotoToSend {
  index: number;
  url: string;
  caption: string;
}

export interface ImagePlan {
  photos: PhotoToSend[];
  links: ImageLink[];
  /** true nếu vì hạn mức tin mà mọi ảnh thành link (quyết định 7). */
  quotaLimited: boolean;
}

/**
 * Bước E, mục 3 bước 1-2: chọn ảnh gửi thẳng và ảnh thành link.
 * `sentBefore`: số tin đã gửi trong tháng trước câu trả lời này.
 * Chú thích tự đặt "Bước i/n" với n là tổng số ảnh của mục.
 */
export function planImages(
  images: KbImage[],
  maxPerAnswer: number,
  sentBefore: number,
  monthlyLimit: number,
): ImagePlan {
  const total = images.length;
  let n = Math.max(0, Math.min(total, Math.floor(maxPerAnswer)));
  let quotaLimited = false;
  if (n > 0 && sentBefore + 1 + n > monthlyLimit) {
    n = 0;
    quotaLimited = true;
  }
  const photos = images.slice(0, n).map((im, i) => ({
    index: i + 1,
    url: im.url,
    caption: im.caption || `Bước ${i + 1}/${total}`,
  }));
  const links = images.slice(n).map((im, i) => ({ index: n + i + 1, url: im.url }));
  return { photos, links, quotaLimited };
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
