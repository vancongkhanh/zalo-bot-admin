import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { analyzeOaRequest, createOaHandler, hash8, maskId, OaKeys, OaRequest } from "../src/oaWebhook";

// Giá trị giả, chỉ dùng trong kiểm thử (cấu trúc theo mẫu trong tài liệu Zalo OA).
const OA_SECRET = "fake-oa-secret-key-0001";
const APP_SECRET = "fake-app-secret-key-0002";
const APP_ID = "360846524940903967";
const USER_ID = "246845883529197922";
const OA_ID = "388613280878808645";
const GROUP_ID = "f414c8f76fa586fbdfb4";
const TS = "1543908534746";
const SECRET_TEXT = "Noi dung bi mat cua nguoi dung xin thu tuc";

const userSendText = {
  app_id: APP_ID,
  sender: { id: USER_ID },
  user_id_by_app: "552177279717587730",
  recipient: { id: OA_ID },
  event_name: "user_send_text",
  message: { text: SECRET_TEXT, msg_id: "96d3cdf3af150460909" },
  timestamp: TS,
};

const userSendImage = {
  app_id: APP_ID,
  sender: { id: USER_ID },
  user_id_by_app: "552177279717587730",
  recipient: { id: OA_ID },
  event_name: "user_send_image",
  message: {
    msg_id: "b8f0a9c1d2e3",
    text: "anh giay to",
    attachments: [
      { type: "image", payload: { url: "https://photo.example/secret.jpg", thumbnail: "https://photo.example/t.jpg" } },
    ],
  },
  timestamp: TS,
};

const userSendGroupText = {
  app_id: APP_ID,
  oa_id: OA_ID,
  sender: { id: USER_ID },
  recipient: { id: GROUP_ID },
  event_name: "user_send_group_text",
  message: { text: `[@${OA_ID}] ${SECRET_TEXT}`, msg_id: "g1", quote_msg_id: "g0" },
  timestamp: TS,
};

const oaSendGroupText = {
  app_id: APP_ID,
  sender: { id: OA_ID },
  recipient: { id: GROUP_ID },
  event_name: "oa_send_group_text",
  message: { text: SECRET_TEXT, msg_id: "g2" },
  timestamp: TS,
};

const SENSITIVE = [SECRET_TEXT, "anh giay to", USER_ID, OA_ID, GROUP_ID, APP_ID, "552177279717587730", "photo.example", OA_SECRET, APP_SECRET];

function jsonReq(body: unknown, headers: Record<string, string> = {}): OaRequest {
  const raw = Buffer.from(JSON.stringify(body), "utf8");
  return {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(raw.length), ...headers },
    rawBody: raw,
    body,
  };
}

function run(req: OaRequest, keys: OaKeys = {}, log?: (e: Record<string, unknown>) => void) {
  const entries: Record<string, unknown>[] = [];
  const responses: { status: number; body: unknown }[] = [];
  const handler = createOaHandler({ getKeys: () => keys, log: log ?? ((e) => entries.push(e)) });
  handler(req, {
    status(code) {
      return { json: (body) => responses.push({ status: code, body }) };
    },
  });
  return { entry: entries[0], responses };
}

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("zaloOaWebhook: luôn trả 200", () => {
  const cases: [string, OaRequest][] = [
    ["user_send_text", jsonReq(userSendText)],
    ["user_send_image", jsonReq(userSendImage)],
    ["user_send_group_text", jsonReq(userSendGroupText)],
    ["oa_send_group_text", jsonReq(oaSendGroupText)],
    ["POST rỗng", { method: "POST", headers: {}, rawBody: Buffer.alloc(0), body: {} }],
    ["POST không có rawBody", { method: "POST", headers: {}, body: undefined }],
    ["body không phải JSON", { method: "POST", headers: { "content-type": "text/plain" }, rawBody: Buffer.from("not json {"), body: "not json {" }],
    ["JSON là mảng", { method: "POST", headers: {}, rawBody: Buffer.from("[1,2]") }],
    ["GET", { method: "GET", headers: { "user-agent": "curl/8" } }],
    ["PUT", { method: "PUT", headers: {} }],
  ];

  for (const [name, req] of cases) {
    it(name, () => {
      const { entry, responses } = run(req, { oa: OA_SECRET, app: APP_SECRET });
      expect(responses).toEqual([{ status: 200, body: { ok: true } }]);
      expect(entry).toBeDefined();
      const line = JSON.stringify(entry);
      for (const s of SENSITIVE) expect(line).not.toContain(s);
    });
  }

  it("body không phải JSON: body_parse_ok=false", () => {
    const { entry } = run({ method: "POST", headers: {}, rawBody: Buffer.from("xx") });
    expect(entry.body_parse_ok).toBe(false);
    expect(entry.body_keys).toEqual([]);
  });

  it("logger ném lỗi vẫn trả 200", () => {
    const { responses } = run(jsonReq(userSendText), {}, () => {
      throw new Error("log hỏng");
    });
    expect(responses).toEqual([{ status: 200, body: { ok: true } }]);
  });

  it("getKeys ném lỗi (secret chưa gắn) vẫn trả 200, khóa là skipped", () => {
    const entries: Record<string, unknown>[] = [];
    const responses: number[] = [];
    createOaHandler({
      getKeys: () => {
        throw new Error("no secret");
      },
      log: (e) => entries.push(e),
    })(jsonReq(userSendText), { status: (c) => ({ json: () => responses.push(c) }) });
    expect(responses).toEqual([200]);
    expect(entries[0].sig_match).toEqual({ oa_key: "skipped", app_key: "skipped" });
  });

  it("request lạ làm phân tích ném lỗi vẫn trả 200", () => {
    const evil = {
      method: "POST",
      get headers(): Record<string, string> {
        throw new Error("boom");
      },
    } as OaRequest;
    const { entry, responses } = run(evil);
    expect(responses).toEqual([{ status: 200, body: { ok: true } }]);
    expect(entry.analyze_error).toBe("Error");
  });
});

describe("zaloOaWebhook: nội dung log", () => {
  it("user_send_text", () => {
    const { entry } = run(jsonReq(userSendText, { "x-zevent-signature": "mac=" + "a".repeat(64), "x-zevent-num-retry": "1" }));
    expect(entry).toMatchObject({
      method: "POST",
      content_type: "application/json",
      body_parse_ok: true,
      event_name: "user_send_text",
      app_id: "360...967",
      timestamp: TS,
      msg_id: "96d3cdf3af150460909",
      sender_hash: hash8(USER_ID),
      recipient_hash: hash8(OA_ID),
      text_length: Array.from(SECRET_TEXT).length,
      has_quote_msg_id: false,
      attachment_types: [],
      is_group: false,
      is_oa_echo: false,
      num_retry: "1",
      raw_body_source: "rawBody",
      x_zevent_signature: { length: 68, prefix6: "mac=aa", has_mac_prefix: true },
    });
    expect(entry.body_keys).toEqual(["app_id", "event_name", "message", "recipient", "sender", "timestamp", "user_id_by_app"]);
    expect(entry.header_names).toEqual(["content-length", "content-type", "x-zevent-num-retry", "x-zevent-signature"]);
    expect(entry).not.toHaveProperty("group_id_hash");
    expect(String(entry.sender_hash)).toHaveLength(8);
  });

  it("user_send_image: chỉ ghi loại đính kèm", () => {
    const { entry } = run(jsonReq(userSendImage));
    expect(entry.attachment_types).toEqual(["image"]);
    expect(entry.event_name).toBe("user_send_image");
  });

  it("user_send_group_text: gắn cờ nhóm, mentions_oa=true", () => {
    const { entry } = run(jsonReq(userSendGroupText));
    expect(entry).toMatchObject({
      is_group: true,
      is_oa_echo: false,
      group_id_hash: hash8(GROUP_ID),
      oa_id_source: "oa_id",
      mentions_oa: true,
      has_mention_marker: true,
      has_quote_msg_id: true,
    });
  });

  it("user_send_group_text không nhắc OA: mentions_oa=false", () => {
    const { entry } = run(jsonReq({ ...userSendGroupText, message: { text: "xin chao", msg_id: "g3" } }));
    expect(entry.mentions_oa).toBe(false);
    expect(entry.has_mention_marker).toBe(false);
  });

  it("oa_send_group_text: is_oa_echo=true", () => {
    const { entry } = run(jsonReq(oaSendGroupText));
    expect(entry).toMatchObject({ is_group: true, is_oa_echo: true, oa_id_source: "sender", mentions_oa: false });
  });

  it("cold_start chỉ đúng ở request đầu của instance; duration_ms đo được", () => {
    const entries: Record<string, unknown>[] = [];
    const handler = createOaHandler({ getKeys: () => ({}), log: (e) => entries.push(e) });
    const res = { status: () => ({ json: () => undefined }) };
    handler(jsonReq(userSendText), res);
    handler(jsonReq(userSendText), res);
    expect(entries.map((e) => e.cold_start)).toEqual([true, false]);
    for (const e of entries) {
      expect(typeof e.duration_ms).toBe("number");
      expect(e.duration_ms as number).toBeGreaterThanOrEqual(0);
    }
  });

  it("duration_ms dưới 50 ms với body lớn (~200 KB)", () => {
    const big = { ...userSendText, message: { text: "x".repeat(200_000), msg_id: "big" } };
    const { entry } = run(jsonReq(big), { oa: OA_SECRET, app: APP_SECRET });
    expect(entry.duration_ms as number).toBeLessThan(50);
    expect(entry.text_length).toBe(200_000);
  });

  it("dùng đồng hồ tiêm vào để tính duration_ms", () => {
    const times = [100, 102.5];
    const entries: Record<string, unknown>[] = [];
    createOaHandler({ getKeys: () => ({}), log: (e) => entries.push(e), now: () => times.shift()! })(
      { method: "GET" },
      { status: () => ({ json: () => undefined }) },
    );
    expect(entries[0].duration_ms).toBe(2.5);
  });

  it("maskId", () => {
    expect(maskId("1234567890")).toBe("123...890");
    expect(maskId("12345")).toBe("***");
    expect(maskId(null)).toBeNull();
  });
});

describe("zaloOaWebhook: thử chữ ký", () => {
  // Body có khoảng trắng/thứ tự khóa riêng: parse rồi stringify lại sẽ ra bytes khác.
  const rawText = `{ "app_id":"${APP_ID}",  "event_name":"user_send_text","timestamp":"${TS}",\n "message":{"text":"${SECRET_TEXT}","msg_id":"m1"} }`;
  const raw = Buffer.from(rawText, "utf8");
  const req = (sig: string | undefined, extra: Record<string, string> = {}): OaRequest => ({
    method: "POST",
    headers: { "content-type": "application/json", ...(sig ? { "x-zevent-signature": sig } : {}), ...extra },
    rawBody: raw,
    body: JSON.parse(rawText),
  });
  const v1 = (secret: string) => sha(APP_ID + rawText + TS + secret);

  it("V1 khớp với khóa OA, khóa App là none", () => {
    const e = analyzeOaRequest(req(v1(OA_SECRET)), { oa: OA_SECRET, app: APP_SECRET });
    expect(e.sig_match).toEqual({ oa_key: "V1", app_key: "none" });
  });

  it("V1 khớp với khóa App (chữ hoa vẫn khớp)", () => {
    const e = analyzeOaRequest(req(v1(APP_SECRET).toUpperCase()), { oa: OA_SECRET, app: APP_SECRET });
    expect(e.sig_match).toEqual({ oa_key: "none", app_key: "V1" });
  });

  it("V2: tiền tố mac=", () => {
    const e = analyzeOaRequest(req("mac=" + v1(OA_SECRET)), { oa: OA_SECRET, app: APP_SECRET });
    expect(e.sig_match).toEqual({ oa_key: "V2", app_key: "none" });
  });

  it("V3: HMAC-SHA256", () => {
    const sig = createHmac("sha256", APP_SECRET).update(APP_ID + rawText + TS, "utf8").digest("hex");
    const e = analyzeOaRequest(req(sig), { oa: OA_SECRET, app: APP_SECRET });
    expect(e.sig_match).toEqual({ oa_key: "none", app_key: "V3" });
  });

  it("V4: timestamp lấy từ header", () => {
    const headerTs = "1700000000000";
    const sig = sha(APP_ID + rawText + headerTs + OA_SECRET);
    const e = analyzeOaRequest(req(sig, { "x-zevent-timestamp": headerTs }), { oa: OA_SECRET });
    expect(e.sig_match).toEqual({ oa_key: "V4", app_key: "skipped" });
  });

  it("tính trên raw body: chữ ký theo JSON.stringify lại thì không khớp", () => {
    const restringified = JSON.stringify(JSON.parse(rawText));
    expect(restringified).not.toBe(rawText);
    const sig = sha(APP_ID + restringified + TS + OA_SECRET);
    const e = analyzeOaRequest(req(sig), { oa: OA_SECRET });
    expect((e.sig_match as Record<string, string>).oa_key).toBe("none");
  });

  it("khóa thiếu hoặc giữ chỗ thì skipped", () => {
    expect(analyzeOaRequest(req(v1(OA_SECRET)), {}).sig_match).toEqual({ oa_key: "skipped", app_key: "skipped" });
    expect(analyzeOaRequest(req(v1(OA_SECRET)), { oa: "none", app: " " }).sig_match).toEqual({
      oa_key: "skipped",
      app_key: "skipped",
    });
    expect(analyzeOaRequest(req(v1(OA_SECRET)), { oa: OA_SECRET, app: "NONE" }).sig_match).toEqual({
      oa_key: "V1",
      app_key: "skipped",
    });
  });

  it("không có header chữ ký: none (không chặn request)", () => {
    const { entry, responses } = run(req(undefined), { oa: OA_SECRET, app: APP_SECRET });
    expect(entry.sig_match).toEqual({ oa_key: "none", app_key: "none" });
    expect(entry.x_zevent_signature).toBeNull();
    expect(responses[0].status).toBe(200);
  });

  it("chữ ký sai vẫn trả 200; log không chứa chữ ký đủ hay giá trị tính ra", () => {
    const good = v1(OA_SECRET);
    const wrong = "f".repeat(64);
    const { entry, responses } = run(req(wrong), { oa: OA_SECRET, app: APP_SECRET });
    expect(responses[0]).toEqual({ status: 200, body: { ok: true } });
    const line = JSON.stringify(entry);
    expect(line).not.toContain(wrong);
    expect(line).not.toContain(good);
    expect(line).not.toContain(OA_SECRET);
    expect(line).not.toContain(SECRET_TEXT);
  });
});
