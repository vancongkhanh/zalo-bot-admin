/**
 * Kiểm thử FirestoreStore với một Firestore giả trong bộ nhớ.
 * (Máy chưa có Java nên chưa chạy được trình giả lập Firestore.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    increment: (n: number) => ({ __inc: n }),
    serverTimestamp: () => ({ __ts: true }),
  },
  Timestamp: { fromMillis: (ms: number) => ({ __ms: ms }) },
}));

import { EVENT_TTL_MS, FirestoreStore } from "../src/store";
import type { Firestore } from "firebase-admin/firestore";

type Data = Record<string, unknown>;

class FakeDb {
  docs = new Map<string, Data>();
  failNextCreateWith: unknown = null;

  private apply(prev: Data | undefined, patch: Data): Data {
    const out: Data = { ...(prev ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === "object" && "__inc" in v) {
        out[k] = ((out[k] as number) ?? 0) + (v as { __inc: number }).__inc;
      } else if (v && typeof v === "object" && "__ts" in v) {
        out[k] = "SERVER_TS";
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  private snap(path: string) {
    const d = this.docs.get(path);
    return { exists: d !== undefined, data: () => d, get: (f: string) => d?.[f] };
  }

  private ref(path: string) {
    return {
      path,
      get: async () => this.snap(path),
      create: async (data: Data) => {
        if (this.failNextCreateWith) {
          const e = this.failNextCreateWith;
          this.failNextCreateWith = null;
          throw e;
        }
        if (this.docs.has(path)) throw Object.assign(new Error("6 ALREADY_EXISTS: Document already exists"), { code: 6 });
        this.docs.set(path, this.apply(undefined, data));
      },
      update: async (data: Data) => {
        if (!this.docs.has(path)) throw Object.assign(new Error("5 NOT_FOUND"), { code: 5 });
        this.docs.set(path, this.apply(this.docs.get(path), data));
      },
      set: async (data: Data, opts?: { merge?: boolean }) => {
        this.docs.set(path, this.apply(opts?.merge ? this.docs.get(path) : undefined, data));
      },
    };
  }

  collection(name: string) {
    return { doc: (id: string) => this.ref(`${name}/${id}`) };
  }

  async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    const tx = {
      get: (ref: { path: string }) => Promise.resolve(this.snap(ref.path)),
      set: (ref: { path: string }, data: Data, opts?: { merge?: boolean }) => {
        this.docs.set(ref.path, this.apply(opts?.merge ? this.docs.get(ref.path) : undefined, data));
      },
    };
    return fn(tx);
  }
}

const NOW = Date.parse("2026-11-16T03:00:00Z");
let db: FakeDb;
let store: FirestoreStore;

beforeEach(() => {
  db = new FakeDb();
  store = new FirestoreStore(db as unknown as Firestore, () => NOW);
});

describe("getConfig", () => {
  it("chưa có config/main → mặc định kèm cảnh báo", async () => {
    const { config, warnings } = await store.getConfig();
    expect(config.allowedChatIds).toEqual([]);
    expect(warnings.length).toBe(1);
  });
  it("đọc config/main", async () => {
    db.docs.set("config/main", { allowed_chat_ids: ["zgr-a", "zgr-b"], reply_enabled: false });
    const { config } = await store.getConfig();
    expect(config.allowedChatIds).toEqual(["zgr-a", "zgr-b"]);
    expect(config.replyEnabled).toBe(false);
  });
});

describe("chống trùng: claimEvent", () => {
  it("lần đầu tạo tài liệu processing, expire_at sau 7 ngày; lần hai trả false", async () => {
    expect(await store.claimEvent("m1")).toBe(true);
    expect(db.docs.get("processed_events/m1")).toEqual({
      received_at: "SERVER_TS",
      state: "processing",
      expire_at: { __ms: NOW + EVENT_TTL_MS },
    });
    expect(await store.claimEvent("m1")).toBe(false);
    expect(db.docs.get("processed_events/m1")?.state).toBe("processing");
  });

  it("lỗi khác ALREADY_EXISTS thì ném ra (không nuốt lỗi)", async () => {
    db.failNextCreateWith = Object.assign(new Error("14 UNAVAILABLE"), { code: 14 });
    await expect(store.claimEvent("m2")).rejects.toThrow("UNAVAILABLE");
  });

  it("setEventState cập nhật trạng thái", async () => {
    await store.claimEvent("m1");
    await store.setEventState("m1", "done");
    expect(db.docs.get("processed_events/m1")).toMatchObject({ state: "done", updated_at: "SERVER_TS" });
  });
});

describe("bộ đếm usage", () => {
  it("tăng messages_sent và send_errors bằng increment, đọc lại đúng", async () => {
    expect(await store.getMonthlySent("2026-11")).toBe(0);
    await store.recordSendSuccess("2026-11");
    await store.recordSendSuccess("2026-11");
    await store.recordSendError("2026-11");
    expect(await store.getMonthlySent("2026-11")).toBe(2);
    expect(db.docs.get("usage/2026-11")).toMatchObject({ messages_sent: 2, send_errors: 1 });
  });

  it("cảnh báo 80% chỉ đánh dấu một lần mỗi tháng, không xóa bộ đếm", async () => {
    await store.recordSendSuccess("2026-11");
    expect(await store.markQuotaWarning("2026-11")).toBe(true);
    expect(await store.markQuotaWarning("2026-11")).toBe(false);
    expect(await store.markQuotaWarning("2026-12")).toBe(true);
    expect(db.docs.get("usage/2026-11")).toMatchObject({ messages_sent: 1, quota_warning_sent: true });
  });
});

describe("writeConversation", () => {
  it("ghi đủ trường và created_at", async () => {
    await store.writeConversation("m1", {
      chat_id: "zgr-a",
      from_id: "u1",
      display_name: "Ten",
      question: "xin chào",
      reply_text: "Đã nhận: xin chào",
      outcome: "replied",
      ignore_reason: null,
      error: null,
      duration_ms: 123,
    });
    expect(db.docs.get("conversations/m1")).toEqual({
      chat_id: "zgr-a",
      from_id: "u1",
      display_name: "Ten",
      question: "xin chào",
      reply_text: "Đã nhận: xin chào",
      outcome: "replied",
      ignore_reason: null,
      error: null,
      duration_ms: 123,
      created_at: "SERVER_TS",
    });
  });
});
