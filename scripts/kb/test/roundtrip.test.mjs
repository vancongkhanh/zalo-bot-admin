// Kiểm thử đầu-cuối với Firestore giả: Excel → nạp → xuất → nạp lại không đổi (B1, B2, B4),
// cộng duyệt/ẩn và bộ thử. Không cần mạng hay Firestore thật.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { applyPlan, KB, loadKb } from "../lib/db.mjs";
import { KHO_COLUMNS, readSheet, writeKho } from "../lib/excel.mjs";
import { planImport } from "../lib/plan.mjs";
import { setStatus } from "../lib/status.mjs";
import { planTestset } from "../lib/testset.mjs";

class FakeDb {
  docs = new Map();
  collection(name) {
    return {
      get: async () => ({
        docs: [...this.docs.entries()]
          .filter(([k]) => k.startsWith(name + "/"))
          .map(([k, v]) => ({ id: k.slice(name.length + 1), data: () => structuredClone(v) })),
      }),
      doc: (id) => this.ref(`${name}/${id}`),
    };
  }
  ref(path) {
    return {
      path,
      get: async () => ({ exists: this.docs.has(path), data: () => structuredClone(this.docs.get(path)) }),
      update: async (d) => this.update(path, d),
    };
  }
  clean(d) {
    // Thay giá trị FieldValue (sentinel) bằng chuỗi để structuredClone được.
    return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v && typeof v === "object" && v.constructor?.name?.includes("Transform") ? "SERVER_TS" : v]));
  }
  update(path, d) {
    if (!this.docs.has(path)) throw new Error("NOT_FOUND " + path);
    this.docs.set(path, { ...this.docs.get(path), ...this.clean(d) });
  }
  batch() {
    const ops = [];
    return {
      create: (ref, d) => ops.push(() => {
        if (this.docs.has(ref.path)) throw new Error("ALREADY_EXISTS " + ref.path);
        this.docs.set(ref.path, this.clean(d));
      }),
      update: (ref, d) => ops.push(() => this.update(ref.path, d)),
      set: (ref, d) => ops.push(() => this.docs.set(ref.path, this.clean(d))),
      commit: async () => ops.forEach((op) => op()),
    };
  }
}

const dir = mkdtempSync(join(tmpdir(), "kb-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const SAMPLE = [
  ["vi-du-1", "(VÍ DỤ)", "Nhóm", "a\nb", "ví dụ", "", "", "", "", "draft", "dòng ví dụ"],
  ["dang-nhap-quen-mat-khau", "Quên mật khẩu", "Tài khoản", "quên mật khẩu\nquen mk\nkhông vào được", "Bước 1: bấm Quên mật khẩu.\nBước 2: nhập email.", "", "Video | https://youtu.be/abc\nhttps://drive.google.com/x", "mật khẩu, đăng nhập", "HDSD v2, trang 12", "approved", "ghi chú riêng"],
  ["nop-ho-so", "Nộp hồ sơ trực tuyến", "Hồ sơ", "nộp hồ sơ\nnop ho so online", "Chọn Dịch vụ công > Nộp hồ sơ.", "", "", "", "HDSD v2, trang 30", "", ""],
  ["qua-dai", "Câu quá dài", "Hồ sơ", "a\nb", "x".repeat(1600), "", "", "", "Nguồn", "draft", ""],
  ["link-sai", "Link sai", "Hồ sơ", "a\nb", "ok", "", "Video | http://example.com", "", "Nguồn", "draft", ""],
  ["", "Thiếu slug", "Hồ sơ", "a\nb", "ok", "", "", "", "Nguồn", "draft", ""],
];

async function makeWorkbook(path, rows, testRows = []) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Kho");
  ws.addRow(KHO_COLUMNS);
  for (const r of rows) ws.addRow(r);
  const bt = wb.addWorksheet("Bo_thu");
  bt.addRow(["stt", "cau_hoi_that", "slug_dung", "ghi_chu"]);
  for (const r of testRows) bt.addRow(r);
  await wb.xlsx.writeFile(path);
}

let db;
beforeEach(() => {
  db = new FakeDb();
});

describe("vòng nạp và xuất", () => {
  it("B1: nạp tệp mẫu đúng số mục và đúng nội dung; B3: dòng lỗi bị từ chối", async () => {
    const f = join(dir, "b1.xlsx");
    await makeWorkbook(f, SAMPLE);
    const { rows } = await readSheet(f, "Kho");
    const plan = planImport(rows, await loadKb(db));
    expect(plan.skipped).toHaveLength(1);
    expect(plan.rejected.map((r) => r.slug)).toEqual(["qua-dai", "link-sai", ""]);
    await applyPlan(db, plan);

    const kb = await loadKb(db);
    expect([...kb.keys()].sort()).toEqual(["dang-nhap-quen-mat-khau", "nop-ho-so"]);
    expect(kb.get("dang-nhap-quen-mat-khau")).toMatchObject({
      title: "Quên mật khẩu",
      topic: "Tài khoản",
      questions: ["quên mật khẩu", "quen mk", "không vào được"],
      answer: "Bước 1: bấm Quên mật khẩu.\nBước 2: nhập email.",
      links: [
        { label: "Video", url: "https://youtu.be/abc", platform: "youtube" },
        { label: "Drive", url: "https://drive.google.com/x", platform: "drive" },
      ],
      keywords: ["mật khẩu", "đăng nhập"],
      source: "HDSD v2, trang 12",
      status: "approved",
      approved_by: "kb-import",
      version: 1,
      hit_count: 0,
      steps: [],
      images: [],
    });
    expect(kb.get("nop-ho-so")).toMatchObject({ status: "draft", approved_by: null });
    expect(kb.get("dang-nhap-quen-mat-khau")).not.toHaveProperty("ghi_chu");
  });

  it("B2: nạp lại cùng tệp không sinh trùng; mục approved không bị ghi đè nếu không có cờ", async () => {
    const f = join(dir, "b2.xlsx");
    await makeWorkbook(f, SAMPLE);
    const { rows } = await readSheet(f, "Kho");
    await applyPlan(db, planImport(rows, await loadKb(db)));
    const again = planImport(rows, await loadKb(db));
    expect(again.creates).toEqual([]);
    expect(again.updates).toEqual([]);
    expect(again.unchanged).toHaveLength(2);

    const edited = SAMPLE.map((r) => (r[0] === "dang-nhap-quen-mat-khau" ? r.map((c, i) => (i === 4 ? "Nội dung đã sửa." : c)) : r));
    const f2 = join(dir, "b2-edit.xlsx");
    await makeWorkbook(f2, edited);
    const { rows: rows2 } = await readSheet(f2, "Kho");
    const p = planImport(rows2, await loadKb(db));
    expect(p.conflicts.map((c) => c.slug)).toEqual(["dang-nhap-quen-mat-khau"]);
    await applyPlan(db, p);
    expect((await loadKb(db)).get("dang-nhap-quen-mat-khau").answer).toBe("Bước 1: bấm Quên mật khẩu.\nBước 2: nhập email.");

    await applyPlan(db, planImport(rows2, await loadKb(db), { overwriteApproved: true }));
    const after = (await loadKb(db)).get("dang-nhap-quen-mat-khau");
    expect(after.answer).toBe("Nội dung đã sửa.");
    expect(after.version).toBe(2);
  });

  it("B4: kb-export rồi kb-import cho kết quả không đổi (kể cả mục hidden)", async () => {
    const f = join(dir, "b4.xlsx");
    await makeWorkbook(f, SAMPLE);
    const { rows } = await readSheet(f, "Kho");
    await applyPlan(db, planImport(rows, await loadKb(db)));
    await setStatus(db, ["nop-ho-so"], "hidden", "kb-hide");
    const before = await loadKb(db);

    const out = join(dir, "b4-export.xlsx");
    await writeKho(out, [...before.entries()].map(([slug, d]) => ({ slug, ...d })));
    const { rows: exported, header } = await readSheet(out, "Kho");
    expect(header).toEqual(KHO_COLUMNS);
    const p = planImport(exported, before);
    expect(p.creates).toEqual([]);
    expect(p.updates).toEqual([]);
    expect(p.conflicts).toEqual([]);
    expect(p.rejected).toEqual([]);
    expect(p.unchanged).toHaveLength(2);
    expect(exported.find((r) => r.values.slug === "nop-ho-so").values.trang_thai).toBe("hidden");
    expect(Number(exported.find((r) => r.values.slug === "dang-nhap-quen-mat-khau").values.do_dai_tra_loi)).toBe(46);
  });
});

describe("bước E: ảnh", () => {
  it("E7: nạp lại Excel (kể cả --ghi-de-approved) không làm mất ảnh; xuất có cột so_anh", async () => {
    const f = join(dir, "e7.xlsx");
    await makeWorkbook(f, SAMPLE);
    const { rows } = await readSheet(f, "Kho");
    await applyPlan(db, planImport(rows, await loadKb(db)));
    const images = [{ url: "https://x.test/1.jpg", path: "kb_images/dang-nhap-quen-mat-khau/1.jpg", caption: "" }];
    db.update(`${KB}/dang-nhap-quen-mat-khau`, { images });

    const edited = SAMPLE.map((r) => (r[0] === "dang-nhap-quen-mat-khau" ? r.map((c, i) => (i === 4 ? "Nội dung mới." : c)) : r));
    const f2 = join(dir, "e7-edit.xlsx");
    await makeWorkbook(f2, edited);
    const { rows: rows2 } = await readSheet(f2, "Kho");
    await applyPlan(db, planImport(rows2, await loadKb(db), { overwriteApproved: true }));
    const after = (await loadKb(db)).get("dang-nhap-quen-mat-khau");
    expect(after.answer).toBe("Nội dung mới.");
    expect(after.images).toEqual(images);

    const out = join(dir, "e7-export.xlsx");
    const kb = await loadKb(db);
    await writeKho(out, [...kb.entries()].map(([slug, d]) => ({ slug, ...d })));
    const { rows: exported } = await readSheet(out, "Kho");
    expect(exported.find((r) => r.values.slug === "dang-nhap-quen-mat-khau").values.so_anh).toBe("1");
    expect(exported.find((r) => r.values.slug === "nop-ho-so").values.so_anh).toBe("0");
    // Xuất rồi nạp lại: cột so_anh không gây thay đổi.
    const p = planImport(exported, kb);
    expect(p.updates).toEqual([]);
    expect(p.creates).toEqual([]);
  });
});

describe("duyệt và ẩn", () => {
  it("kb-approve chỉ duyệt mục đủ điều kiện; kb-hide không đổi nội dung", async () => {
    const f = join(dir, "st.xlsx");
    await makeWorkbook(f, [
      ["du-dieu-kien", "A", "", "a\nb", "ok", "", "", "", "Nguồn", "", ""],
      ["thieu-nguon", "B", "", "a\nb", "ok", "", "", "", "", "", ""],
    ]);
    const { rows } = await readSheet(f, "Kho");
    await applyPlan(db, planImport(rows, await loadKb(db)));

    const res = await setStatus(db, ["du-dieu-kien", "thieu-nguon", "khong-co", "Sai Slug"], "approved", "kb-approve");
    expect(res.map((r) => r.changed)).toEqual([true, false, false, false]);
    expect(res[1].result).toContain("thiếu nguồn");
    const kb = await loadKb(db);
    expect(kb.get("du-dieu-kien")).toMatchObject({ status: "approved", approved_by: "kb-approve" });
    expect(kb.get("thieu-nguon").status).toBe("draft");

    const before = kb.get("du-dieu-kien");
    await setStatus(db, ["du-dieu-kien"], "hidden", "kb-hide");
    const after = (await loadKb(db)).get("du-dieu-kien");
    expect(after.status).toBe("hidden");
    expect(after.answer).toBe(before.answer);
    expect(after.version).toBe(before.version);
  });
});

describe("bộ thử", () => {
  it("đọc Bo_thu, bỏ ví dụ, báo lỗi và cảnh báo slug chưa có trong kho; không đụng kb_items", async () => {
    const f = join(dir, "bt.xlsx");
    await makeWorkbook(f, [], [
      [1, "(VÍ DỤ - xóa) câu hỏi", "vi-du-1", ""],
      [1, "quên mật khẩu thì làm sao", "dang-nhap-quen-mat-khau", ""],
      [2, "hỏi ngoài kho", "", "mong đợi chuyển ca"],
      [3, "slug chưa có", "chua-co", ""],
      [3, "trùng stt", "", ""],
      ["x", "stt sai", "", ""],
    ]);
    const { rows } = await readSheet(f, "Bo_thu");
    const kb = new Map([["dang-nhap-quen-mat-khau", {}]]);
    const { ok, bad, warn, skipped } = planTestset(rows, kb);
    expect(skipped).toBe(1);
    expect(ok.map((t) => t.id)).toEqual(["t-01", "t-02", "t-03"]);
    expect(ok[1].expected_slug).toBeNull();
    expect(bad.map((b) => b.dong)).toEqual([6, 7]);
    expect(warn).toHaveLength(1);
    expect(db.docs.size).toBe(0);
    expect(KB).toBe("kb_items");
  });
});
