// Đổi trạng thái mục (dùng cho kb-approve, kb-hide). Không xóa mục, không đổi nội dung.
import { FieldValue } from "firebase-admin/firestore";
import { KB } from "./db.mjs";
import { SLUG_PATTERN } from "./validate.mjs";

/** Lý do không duyệt được (rỗng = duyệt được). Cùng quy tắc với kb-import. */
export function approveProblems(d) {
  const problems = [];
  if (!d.answer) problems.push("thiếu nội dung trả lời");
  if (!Array.isArray(d.questions) || d.questions.length < 2) problems.push("cần ít nhất 2 cách hỏi");
  if (!d.source) problems.push("thiếu nguồn");
  return problems;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string[]} slugs
 * @param {"approved"|"hidden"} target
 * @param {string} approver  nhãn ghi vào approved_by khi duyệt
 * @returns {Promise<Array<{slug:string, result:string, changed:boolean}>>}
 */
export async function setStatus(db, slugs, target, approver) {
  const out = [];
  for (const slug of slugs) {
    if (!SLUG_PATTERN.test(slug)) {
      out.push({ slug, result: "slug sai định dạng, bỏ qua", changed: false });
      continue;
    }
    const ref = db.collection(KB).doc(slug);
    const snap = await ref.get();
    if (!snap.exists) {
      out.push({ slug, result: "không có trong kho, bỏ qua", changed: false });
      continue;
    }
    const d = snap.data();
    if (d.status === target) {
      out.push({ slug, result: `đã là ${target}`, changed: false });
      continue;
    }
    if (target === "approved") {
      const problems = approveProblems(d);
      if (problems.length) {
        out.push({ slug, result: `không duyệt được: ${problems.join(", ")}`, changed: false });
        continue;
      }
    }
    const data = { status: target, updated_at: FieldValue.serverTimestamp() };
    if (target === "approved") {
      data.approved_at = FieldValue.serverTimestamp();
      data.approved_by = approver;
    }
    await ref.update(data);
    out.push({ slug, result: `${d.status} → ${target}`, changed: true });
  }
  return out;
}
