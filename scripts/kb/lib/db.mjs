// Kết nối Firestore bằng Application Default Credentials (gcloud auth application-default login).
// KHÔNG dùng hay tạo tệp khóa dịch vụ.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { IMPORT_APPROVER } from "./plan.mjs";

export const KB = "kb_items";
export const TESTSET = "eval_testset";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export function projectId() {
  const fromEnv = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (fromEnv) return fromEnv;
  const rc = JSON.parse(readFileSync(join(ROOT, ".firebaserc"), "utf8"));
  return rc.projects.default;
}

let db;
export function getDb() {
  if (db) return db;
  const pid = projectId();
  initializeApp({ credential: applicationDefault(), projectId: pid });
  db = getFirestore();
  console.log(`Dự án Firebase: ${pid}`);
  return db;
}

/** Lỗi đăng nhập ADC thường gặp → hướng dẫn ngắn. */
export function explainAuthError(err) {
  const msg = String(err?.message ?? err);
  if (/default credentials|Could not load the default credentials|invalid_grant|reauth/i.test(msg)) {
    return "Chưa đăng nhập ADC hoặc phiên đã hết hạn. Chạy: gcloud auth application-default login";
  }
  if (/PERMISSION_DENIED|7 PERMISSION/i.test(msg)) {
    return "Tài khoản đăng nhập ADC không có quyền trên dự án này.";
  }
  return msg;
}

/** Đọc toàn bộ kb_items → Map slug → dữ liệu. */
export async function loadKb(database) {
  const snap = await database.collection(KB).get();
  const map = new Map();
  for (const d of snap.docs) map.set(d.id, d.data());
  return map;
}

/** Ghi kế hoạch nạp (creates + updates) theo lô 400 thao tác. */
export async function applyPlan(database, plan) {
  const ops = [];
  const now = FieldValue.serverTimestamp();
  for (const c of plan.creates) {
    const data = {
      ...c.data,
      steps: [],
      images: [], // bước E: ảnh chỉ tải lên từ trang quản trị
      hit_count: 0,
      last_hit_at: null,
      created_at: now,
      updated_at: now,
      approved_at: null,
      approved_by: null,
    };
    if (c.data.status === "approved") {
      data.approved_at = now;
      data.approved_by = IMPORT_APPROVER;
    }
    // create(): thất bại nếu ai đó vừa tạo cùng slug, không ghi đè ngầm.
    ops.push((batch) => batch.create(database.collection(KB).doc(c.slug), data));
  }
  for (const u of plan.updates) {
    // u.data chỉ gồm trường nội dung chữ: không bao giờ ghi images (ảnh tải từ trang quản trị).
    const { images: _ignored, ...content } = u.data;
    const data = { ...content, updated_at: now };
    if (u.statusChange && u.statusChange[1] === "approved") {
      data.approved_at = now;
      data.approved_by = IMPORT_APPROVER;
    }
    ops.push((batch) => batch.update(database.collection(KB).doc(u.slug), data));
  }
  for (let i = 0; i < ops.length; i += 400) {
    const batch = database.batch();
    for (const op of ops.slice(i, i + 400)) op(batch);
    await batch.commit();
  }
  return ops.length;
}
