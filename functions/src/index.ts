import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import * as fnLogger from "firebase-functions/logger";
import { setGlobalOptions } from "firebase-functions/v2";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import Anthropic from "@anthropic-ai/sdk";
import {
  ANTHROPIC_API_KEY,
  monthKey,
  ZALO_APP_SECRET_KEY,
  ZALO_BOT_TOKEN,
  ZALO_OA_SECRET_KEY,
  ZALO_WEBHOOK_SECRET,
} from "./config";
import { randomUUID } from "node:crypto";
import { handleSendReply, handleSkipAsks, ReplyDeps } from "./adminReply";
import { FxRate, handleFxRate } from "./fxRate";
import { FirestoreReplyRepo } from "./replyStore";
import { createOaHandler } from "./oaWebhook";
import { FirestoreStore } from "./store";
import { handleSuggest } from "./suggest";
import { handleWebhook, Logger } from "./webhook";
import { createZaloClient } from "./zaloClient";

setGlobalOptions({ region: "asia-southeast1", maxInstances: 5 });
initializeApp();

let store: FirestoreStore | undefined;
let ai: Anthropic | undefined;

const logger: Logger = {
  info: (m, d) => (d ? fnLogger.info(m, d) : fnLogger.info(m)),
  warn: (m, d) => (d ? fnLogger.warn(m, d) : fnLogger.warn(m)),
  error: (m, d) => (d ? fnLogger.error(m, d) : fnLogger.error(m)),
};

/** Firebase tự đọc JSON khi Content-Type là application/json; nếu không, thử đọc từ rawBody. */
function parseBody(body: unknown, rawBody: Buffer | undefined): unknown {
  if (body && typeof body === "object" && !Buffer.isBuffer(body) && Object.keys(body).length > 0) {
    return body;
  }
  const raw = Buffer.isBuffer(body) ? body.toString("utf8") : typeof body === "string" ? body : rawBody?.toString("utf8");
  if (!raw) return body;
  try {
    return JSON.parse(raw);
  } catch {
    return body;
  }
}

export const zaloWebhook = onRequest(
  {
    invoker: "public",
    timeoutSeconds: 60,
    secrets: [ZALO_BOT_TOKEN, ZALO_WEBHOOK_SECRET, ANTHROPIC_API_KEY],
  },
  async (req, res) => {
    store ??= new FirestoreStore(getFirestore());
    const result = await handleWebhook(
      {
        method: req.method,
        headers: req.headers,
        body: req.method === "POST" ? parseBody(req.body, req.rawBody) : undefined,
      },
      {
        webhookSecret: ZALO_WEBHOOK_SECRET.value(),
        store,
        getZaloClient: () => createZaloClient({ token: ZALO_BOT_TOKEN.value() }),
        // Không thử lại: thời gian chờ do ai_timeout_ms quyết định.
        getAiClient: () => (ai ??= new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), maxRetries: 0 })),
        logger,
      },
    );
    res.status(result.status).send(result.body);
  },
);

/**
 * Trang quản trị: AI gợi ý "cách hỏi" cho một mục (chỉ người trong admins gọi được).
 * Gợi ý không gửi cho người dùng Zalo. Bộ đếm riêng: usage/{tháng}.suggest_*.
 */
export const suggestQuestions = onCall(
  { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60, maxInstances: 2 },
  async (request) => {
    store ??= new FirestoreStore(getFirestore());
    const db = getFirestore();
    const r = await handleSuggest(request.auth?.uid, request.data, {
      isAdmin: async (uid) => (await db.collection("admins").doc(uid).get()).exists,
      getClient: () => (ai ??= new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), maxRetries: 0 })),
      getModel: async () => {
        const { config } = await (store as FirestoreStore).getConfig();
        return { model: config.aiModel, timeoutMs: Math.max(config.aiTimeoutMs, 20000) };
      },
      recordUsage: async (call) => {
        await db.collection("usage").doc(monthKey(new Date())).set(
          {
            suggest_calls: FieldValue.increment(1),
            suggest_errors: FieldValue.increment(call.ok ? 0 : 1),
            suggest_input_tokens: FieldValue.increment(call.inputTokens),
            suggest_output_tokens: FieldValue.increment(call.outputTokens),
            updated_at: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      },
      logger,
    });
    if (!r.ok) throw new HttpsError(r.code, r.message);
    return { questions: r.questions };
  },
);

/**
 * Trang quản trị: tỷ giá bán USD của Vietcombank để quy chi phí AI ra VND (chỉ admins gọi được).
 * Lưu đệm 6 giờ ở fx_rates/usd_vnd; client không đọc trực tiếp collection này.
 */
export const usdVndRate = onCall({ timeoutSeconds: 20, maxInstances: 2 }, async (request) => {
  const db = getFirestore();
  const ref = db.collection("fx_rates").doc("usd_vnd");
  const r = await handleFxRate(request.auth?.uid, {
    isAdmin: async (uid) => (await db.collection("admins").doc(uid).get()).exists,
    readCache: async () => {
      const snap = await ref.get();
      return snap.exists ? (snap.data() as FxRate) : null;
    },
    writeCache: async (rate) => {
      await ref.set(rate);
    },
    logger,
  });
  if (!r.ok) throw new HttpsError(r.code, r.message);
  return { ...r.rate, stale: r.stale };
});

function replyDeps(): ReplyDeps {
  store ??= new FirestoreStore(getFirestore());
  const db = getFirestore();
  return {
    isAdmin: async (uid) => (await db.collection("admins").doc(uid).get()).exists,
    repo: new FirestoreReplyRepo(db),
    getConfig: async () => (await (store as FirestoreStore).getConfig()).config,
    getZaloClient: () => createZaloClient({ token: ZALO_BOT_TOKEN.value() }),
    logger,
    newBatchId: () => randomUUID().replace(/-/g, ""),
  };
}

const callerOf = (auth: { uid: string; token: { email?: string } } | undefined) => ({
  uid: auth?.uid,
  email: auth?.token?.email ?? null,
});

/**
 * Trang quản trị: gửi đáp án vào đúng nhóm của những người đã hỏi (docs/spec-tra-loi-nguoi-hoi.md, mục 5).
 * Chỉ người trong admins gọi được. chat_id đích lấy từ ask đã lưu, không từ input.
 * Gửi tuần tự, nghỉ 500 ms giữa các nhóm; timeout dài để đủ cho nhiều nhóm.
 */
export const sendReplyToAskers = onCall(
  { secrets: [ZALO_BOT_TOKEN], timeoutSeconds: 540, maxInstances: 2 },
  async (request) => {
    const r = await handleSendReply(callerOf(request.auth), request.data, replyDeps());
    if (!r.ok) throw new HttpsError(r.code, r.message);
    return { batchId: r.batchId, results: r.results };
  },
);

/** Trang quản trị: đánh dấu bỏ qua (không gửi) một số lượt hỏi. */
export const skipAsks = onCall({ timeoutSeconds: 30, maxInstances: 2 }, async (request) => {
  const r = await handleSkipAsks(callerOf(request.auth), request.data, replyDeps());
  if (!r.ok) throw new HttpsError(r.code, r.message);
  return { skipped: r.skipped, unchanged: r.unchanged };
});

/**
 * OA-0: webhook Zalo OA tối thiểu (docs/spec-oa-0-webhook-toi-thieu.md).
 * Chỉ nhận và ghi một dòng log; luôn trả 200 {"ok":true}. Không dùng Firestore hay token.
 */
const handleOa = createOaHandler({
  getKeys: () => ({ oa: ZALO_OA_SECRET_KEY.value(), app: ZALO_APP_SECRET_KEY.value() }),
  // Thông điệp log: "zalo_verifier_hit" (OA-0b) hoặc "zalo_oa_event" (OA-0).
  log: (entry) => fnLogger.info(typeof entry.event === "string" ? entry.event : "zalo_oa_event", entry),
});

export const zaloOaWebhook = onRequest(
  {
    invoker: "public",
    timeoutSeconds: 10,
    minInstances: 0,
    secrets: [ZALO_OA_SECRET_KEY, ZALO_APP_SECRET_KEY],
  },
  (req, res) => handleOa(req, res),
);
