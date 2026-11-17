import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import * as fnLogger from "firebase-functions/logger";
import { setGlobalOptions } from "firebase-functions/v2";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, monthKey, ZALO_BOT_TOKEN, ZALO_WEBHOOK_SECRET } from "./config";
import { FxRate, handleFxRate } from "./fxRate";
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
