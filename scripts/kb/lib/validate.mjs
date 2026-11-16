// Kiểm tra và chuyển một dòng Excel (sheet Kho) thành mục kho tri thức.
// Không phụ thuộc Firestore để kiểm thử được.

export const MAX_ANSWER_CHARS = 1500;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const STATUSES = ["draft", "approved", "hidden"];
/** Các trường nội dung: đổi một trong số này thì `version` tăng. */
export const CONTENT_FIELDS = ["title", "topic", "questions", "answer", "links", "keywords", "source"];

const PLATFORM_LABEL = { youtube: "YouTube", facebook: "Facebook", drive: "Drive", other: "Liên kết" };

/** Số ký tự Unicode (code point), cùng cách đếm với giai đoạn 1. */
export function charLength(s) {
  return Array.from(s ?? "").length;
}

/** Chuẩn hóa chuỗi từ ô Excel: NFC, xuống dòng về \n, bỏ khoảng trắng hai đầu. */
export function cleanText(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/_x000D_/g, "")
    .replace(/\r\n?/g, "\n")
    .normalize("NFC")
    .trim();
}

/** Tách ô nhiều dòng thành mảng, bỏ dòng trống và dòng trùng (giữ thứ tự). */
export function splitLines(v) {
  const seen = new Set();
  const out = [];
  for (const line of cleanText(v).split("\n")) {
    const t = line.trim().replace(/\s+/g, " ");
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export function splitKeywords(v) {
  const seen = new Set();
  const out = [];
  for (const k of cleanText(v).split(/[,\n]/)) {
    const t = k.trim().replace(/\s+/g, " ");
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export function detectPlatform(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\.|^m\./, "");
  } catch {
    return "other";
  }
  if (host === "youtu.be" || host.endsWith("youtube.com")) return "youtube";
  if (host === "fb.watch" || host.endsWith("facebook.com") || host === "fb.com") return "facebook";
  if (host === "drive.google.com" || host === "docs.google.com") return "drive";
  return "other";
}

/**
 * Đọc ô link: mỗi dòng "Nhãn | https://..." hoặc chỉ "https://...".
 * Trả { links, errors }.
 */
export function parseLinks(v) {
  const links = [];
  const errors = [];
  for (const line of splitLines(v)) {
    const bar = line.lastIndexOf("|");
    const label = bar >= 0 ? line.slice(0, bar).trim() : "";
    const url = (bar >= 0 ? line.slice(bar + 1) : line).trim();
    let ok = false;
    try {
      const u = new URL(url);
      ok = u.protocol === "https:" && !!u.hostname && !/\s/.test(url);
    } catch {
      ok = false;
    }
    if (!ok) {
      errors.push(`link không hợp lệ (phải là "Nhãn | https://..."): ${line.slice(0, 120)}`);
      continue;
    }
    const platform = detectPlatform(url);
    links.push({ label: label || PLATFORM_LABEL[platform], url, platform });
  }
  return { links, errors };
}

export function formatLinks(links) {
  return (links ?? []).map((l) => `${l.label} | ${l.url}`).join("\n");
}

/** Dòng ví dụ trong tệp mẫu: bỏ qua. */
export function isExampleSlug(slug) {
  return cleanText(slug).toLowerCase().startsWith("vi-du");
}

/**
 * Kiểm tra một dòng sheet Kho.
 * @param {Record<string, unknown>} row  khóa = tên cột (slug, tieu_de, nhom, cach_hoi, tra_loi, link, tu_khoa, nguon, trang_thai)
 * @returns {{ item: object|null, errors: string[], warnings: string[] }}
 */
export function validateRow(row) {
  const errors = [];
  const warnings = [];

  const slug = cleanText(row.slug);
  if (!slug) errors.push("slug trống");
  else if (!SLUG_PATTERN.test(slug)) {
    errors.push(`slug "${slug}" sai định dạng (chữ thường không dấu, số, nối bằng gạch ngang)`);
  }

  const title = cleanText(row.tieu_de).replace(/\s+/g, " ");
  if (!title) errors.push("tieu_de trống");

  const answer = cleanText(row.tra_loi);
  const answerLen = charLength(answer);
  if (!answer) errors.push("tra_loi trống");
  else if (answerLen > MAX_ANSWER_CHARS) {
    errors.push(`tra_loi dài ${answerLen} ký tự, tối đa ${MAX_ANSWER_CHARS}`);
  }

  const rawStatus = cleanText(row.trang_thai).toLowerCase();
  const status = rawStatus || "draft";
  if (!STATUSES.includes(status)) errors.push(`trang_thai "${rawStatus}" không hợp lệ (draft, approved, hidden)`);

  const questions = splitLines(row.cach_hoi);
  if (questions.length < 2) {
    const msg = `cach_hoi chỉ có ${questions.length} cách (nên 3-8)`;
    if (status === "approved") errors.push(`${msg}; mục approved cần ít nhất 2`);
    else warnings.push(msg);
  }

  const source = cleanText(row.nguon).replace(/\s+/g, " ");
  if (!source) {
    if (status === "approved") errors.push("nguon trống; mục approved bắt buộc có nguồn");
    else warnings.push("nguon trống");
  }

  const { links, errors: linkErrors } = parseLinks(row.link);
  errors.push(...linkErrors);

  if (errors.length) return { item: null, errors, warnings };

  return {
    item: {
      slug,
      title,
      topic: cleanText(row.nhom).replace(/\s+/g, " "),
      questions,
      answer,
      links,
      keywords: splitKeywords(row.tu_khoa),
      source,
      status,
    },
    errors,
    warnings,
  };
}

/** So sánh nội dung hai mục; trả danh sách tên trường khác nhau. */
export function diffContent(a, b) {
  return CONTENT_FIELDS.filter((f) => JSON.stringify(a?.[f] ?? null) !== JSON.stringify(b?.[f] ?? null));
}

/**
 * Kiểm tra một dòng sheet Bo_thu: stt, cau_hoi_that, slug_dung, ghi_chu.
 * Trả { item: {id, stt, question, expected_slug}|null, errors, skip }.
 */
export function validateTestRow(row) {
  const question = cleanText(row.cau_hoi_that).replace(/\s+/g, " ");
  const expected = cleanText(row.slug_dung);
  const sttRaw = cleanText(row.stt);
  if (!question && !expected && !sttRaw) return { item: null, errors: [], skip: "trống" };
  if (isExampleSlug(expected) || /^\(V[IÍ] DỤ/i.test(question)) return { item: null, errors: [], skip: "ví dụ" };
  const errors = [];
  const stt = Number(sttRaw);
  if (!Number.isInteger(stt) || stt < 1) errors.push(`stt "${sttRaw}" phải là số nguyên dương`);
  if (!question) errors.push("cau_hoi_that trống");
  if (expected && !SLUG_PATTERN.test(expected)) errors.push(`slug_dung "${expected}" sai định dạng`);
  if (errors.length) return { item: null, errors, skip: null };
  return {
    item: { id: `t-${String(stt).padStart(2, "0")}`, stt, question, expected_slug: expected || null },
    errors,
    skip: null,
  };
}
