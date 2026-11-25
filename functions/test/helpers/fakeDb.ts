/**
 * Firestore giả trong bộ nhớ, dùng chung cho store.test và adminReply.test.
 * (Máy chưa có Java nên chưa chạy được trình giả lập Firestore.)
 * Mỗi tệp test phải tự vi.mock("firebase-admin/firestore") với các dạng __inc, __ts, __union, __ms bên dưới.
 */
export type Data = Record<string, unknown>;

export class FakeDb {
  docs = new Map<string, Data>();
  failNextCreateWith: unknown = null;

  private apply(prev: Data | undefined, patch: Data): Data {
    const out: Data = { ...(prev ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === "object" && "__inc" in v) {
        out[k] = ((out[k] as number) ?? 0) + (v as { __inc: number }).__inc;
      } else if (v && typeof v === "object" && "__ts" in v) {
        out[k] = "SERVER_TS";
      } else if (v && typeof v === "object" && "__union" in v) {
        const prevArr = (out[k] as unknown[]) ?? [];
        out[k] = [...prevArr, ...(v as { __union: unknown[] }).__union.filter((x) => !prevArr.includes(x))];
      } else if (
        v &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        Object.values(v).some((x) => x && typeof x === "object" && "__inc" in x)
      ) {
        out[k] = this.apply(out[k] as Data | undefined, v as Data);
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

  private ref(path: string): Record<string, unknown> & { path: string } {
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
      collection: (name: string) => ({ doc: (id: string) => this.ref(`${path}/${name}/${id}`) }),
    };
  }

  reads = 0;
  transactions = 0;

  collection(name: string) {
    return {
      doc: (id: string) => this.ref(`${name}/${id}`),
      where: (field: string, _op: string, value: unknown) => ({
        get: async () => {
          this.reads++;
          const docs = [...this.docs.entries()]
            .filter(([p, d]) => p.startsWith(`${name}/`) && !p.slice(name.length + 1).includes("/") && d[field] === value)
            .map(([p, d]) => ({ id: p.slice(name.length + 1), data: () => d }));
          return { docs };
        },
      }),
    };
  }

  async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    this.transactions++;
    const tx = {
      get: (ref: { path: string }) => Promise.resolve(this.snap(ref.path)),
      set: (ref: { path: string }, data: Data, opts?: { merge?: boolean }) => {
        this.docs.set(ref.path, this.apply(opts?.merge ? this.docs.get(ref.path) : undefined, data));
      },
      create: (ref: { path: string }, data: Data) => {
        this.docs.set(ref.path, this.apply(undefined, data));
      },
      update: (ref: { path: string }, data: Data) => {
        this.docs.set(ref.path, this.apply(this.docs.get(ref.path), data));
      },
    };
    return fn(tx);
  }
}
