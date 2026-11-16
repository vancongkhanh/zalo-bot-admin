import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as fnLogger from "firebase-functions/logger";
import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, ZALO_BOT_TOKEN, ZALO_WEBHOOK_SECRET } from "./config";
import { FirestoreStore } from "./store";
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
