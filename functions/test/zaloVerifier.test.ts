import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createOaHandler, OaRequest } from "../src/oaWebhook";
import { matchVerifier, VERIFIER_FILES } from "../src/zaloVerifier";

const NAME = "zalo_verifierHkI_18tD4Xn7wyS6aUbHBM30WdgCjbaiDZCn.html";
const ORIGINAL = readFileSync(join(__dirname, "..", "..", "docs", NAME));
const CONTENT = ORIGINAL.toString("utf8");
const TOKEN = "HkI_18tD4Xn7wyS6aUbHBM30WdgCjbaiDZCn";

interface Captured {
  status?: number;
  json?: unknown;
  sent?: unknown;
  headers: Record<string, string>;
}

/** Response giả kiểu Express (có setHeader và send). */
function fakeRes(c: Captured) {
  return {
    setHeader(name: string, value: string) {
      c.headers[name.toLowerCase()] = value;
    },
    status(code: number) {
      c.status = code;
      return {
        json: (b: unknown) => (c.json = b),
        send: (b: unknown) => (c.sent = b),
      };
    },
  };
}

function run(req: OaRequest) {
  const logs: Record<string, unknown>[] = [];
  const c: Captured = { headers: {} };
  createOaHandler({ getKeys: () => ({}), log: (e) => logs.push(e) })(req, fakeRes(c));
  return { c, logs };
}

const get = (path: string, method = "GET"): OaRequest => ({ method, path, headers: {} });

function expectOk(c: Captured) {
  expect(c.status).toBe(200);
  expect(c.json).toEqual({ ok: true });
  expect(c.sent).toBeUndefined();
}

describe("OA-0b: tệp xác thực", () => {
  it("nội dung nhúng trùng từng byte với tệp gốc trong docs/", () => {
    expect(Object.keys(VERIFIER_FILES)).toEqual([NAME]);
    expect(Buffer.from(VERIFIER_FILES[NAME], "utf8").equals(ORIGINAL)).toBe(true);
  });

  for (const path of [`/${NAME}`, `/zaloOaWebhook/${NAME}`]) {
    it(`GET ${path}: trả đúng tệp, text/html`, () => {
      const { c, logs } = run(get(path));
      expect(c.status).toBe(200);
      expect(c.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(Buffer.from(c.sent as string, "utf8").equals(ORIGINAL)).toBe(true);
      expect(c.json).toBeUndefined();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ event: "zalo_verifier_hit", file: NAME, matched: true, served: true });
    });
  }

  it("HEAD đúng tên tệp: 200, text/html", () => {
    const { c, logs } = run(get(`/${NAME}`, "HEAD"));
    expect(c.status).toBe(200);
    expect(c.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(logs[0]).toMatchObject({ method: "HEAD", matched: true });
  });

  it("có query string: Express bỏ khỏi req.path nên vẫn khớp", () => {
    // req.path không chứa "?..."; đây là giá trị Express đưa vào.
    expect(matchVerifier(`/${NAME}`)).not.toBeNull();
    expect(matchVerifier(`/${NAME}?x=1`)).toBeNull();
  });

  const nearMisses = [
    `/${NAME.replace(".html", "")}`,
    `/${NAME.replace("HkI", "Hk")}`,
    `/${NAME.replace(".html", "x.html")}`,
    `/${NAME.toUpperCase()}`,
    `/${NAME.replace("HkI", "hkI")}`,
    `/${NAME.replace(".html", ".htm")}`,
    `/${NAME.replace(".html", ".txt")}`,
    `/${NAME}/`,
    `/${NAME} `,
    `/${NAME}.html`,
    `/x/${NAME}`,
    `/zaloOaWebhook/zaloOaWebhook/${NAME}`,
    `/zalowebhook/${NAME}`,
  ];
  for (const path of nearMisses) {
    it(`tên gần giống ${JSON.stringify(path)}: {"ok":true}, không trả tệp`, () => {
      const { c, logs } = run(get(path));
      expectOk(c);
      const v = logs.find((l) => l.event === "zalo_verifier_hit");
      expect(v).toMatchObject({ matched: false, served: false });
      expect(JSON.stringify(logs)).not.toContain(TOKEN.slice(0, 20) + "\"");
    });
  }

  const traversal = [
    "/zalo_verifier../../x",
    "/zalo_verifier../../../functions/package.json",
    "/%2e%2e/" + NAME,
    "/zalo_verifier%2e%2e%2fsecret",
    `/%2e%2e%2f${NAME}`,
    `//${NAME}`,
    `/../${NAME}`,
    `/./${NAME}`,
    `/zaloOaWebhook/../${NAME}`,
    `/${NAME.replace(".html", "%2ehtml")}`,
    `\\${NAME}`,
    "/zalo_verifier\0.html",
  ];
  for (const path of traversal) {
    it(`path traversal ${JSON.stringify(path)}: {"ok":true}`, () => {
      const { c } = run(get(path));
      expectOk(c);
    });
  }

  it("tên trùng thuộc tính Object (__proto__, constructor) không khớp", () => {
    for (const n of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(matchVerifier(`/${n}`)).toBeNull();
      expect(matchVerifier(`/zaloOaWebhook/${n}`)).toBeNull();
    }
  });

  it("path không phải chuỗi: không khớp", () => {
    expect(matchVerifier(undefined)).toBeNull();
    expect(matchVerifier(["/" + NAME])).toBeNull();
  });

  for (const path of ["/", `/${NAME}`]) {
    it(`POST ${path}: {"ok":true} như OA-0`, () => {
      const raw = Buffer.from(JSON.stringify({ event_name: "user_send_text" }));
      const { c, logs } = run({ method: "POST", path, headers: { "content-type": "application/json" }, rawBody: raw });
      expectOk(c);
      expect(logs.some((l) => l.event_name === "user_send_text")).toBe(true);
    });
  }

  for (const m of ["PUT", "DELETE", "OPTIONS"]) {
    it(`${m} đúng tên tệp: {"ok":true}`, () => {
      expectOk(run(get(`/${NAME}`, m)).c);
    });
  }

  it("GET / và GET không có path: giữ OA-0, không log verifier", () => {
    for (const req of [get("/"), { method: "GET", headers: {} }]) {
      const { c, logs } = run(req);
      expectOk(c);
      expect(logs.some((l) => l.event === "zalo_verifier_hit")).toBe(false);
      expect(logs).toHaveLength(1);
    }
  });

  it("log không chứa nội dung tệp", () => {
    const all: Record<string, unknown>[] = [];
    for (const p of [`/${NAME}`, `/${NAME}x`, "/zalo_verifier../../x"]) all.push(...run(get(p)).logs);
    const line = JSON.stringify(all);
    expect(line).not.toContain("zalo-platform-site-verification");
    expect(line).not.toContain("<html");
    expect(line).not.toContain("There Is No Limit");
  });

  it("tên dài bị cắt còn 100 ký tự trong log", () => {
    const { logs } = run(get("/zalo_verifier" + "a".repeat(500)));
    expect(String(logs[0].file).length).toBe(100);
  });

  it("response thiếu send/setHeader (không phải Express): quay về {\"ok\":true}", () => {
    const logs: Record<string, unknown>[] = [];
    const out: unknown[] = [];
    createOaHandler({ getKeys: () => ({}), log: (e) => logs.push(e) })(get(`/${NAME}`), {
      status: () => ({ json: (b) => out.push(b) }),
    });
    expect(out).toEqual([{ ok: true }]);
    expect(logs[0]).toMatchObject({ matched: true, served: false });
  });

  it("send ném lỗi: vẫn trả {\"ok\":true}, Content-Type về JSON", () => {
    const c: Captured = { headers: {} };
    const res = fakeRes(c);
    let first = true;
    createOaHandler({ getKeys: () => ({}), log: () => undefined })(get(`/${NAME}`), {
      setHeader: res.setHeader,
      status(code: number) {
        c.status = code;
        return {
          json: (b: unknown) => (c.json = b),
          send: () => {
            if (first) {
              first = false;
              throw new Error("send lỗi");
            }
          },
        };
      },
    });
    expect(c.json).toEqual({ ok: true });
    expect(c.headers["content-type"]).toBe("application/json; charset=utf-8");
  });

  it("logger ném lỗi: vẫn trả tệp", () => {
    const c: Captured = { headers: {} };
    createOaHandler({
      getKeys: () => ({}),
      log: () => {
        throw new Error("log hỏng");
      },
    })(get(`/${NAME}`), fakeRes(c));
    expect(c.sent).toBe(CONTENT);
  });
});
