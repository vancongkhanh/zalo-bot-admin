// Chấm bộ thử (bước C, mục 4.5). Thuần, không gọi mạng.

/** Giá theo 1 triệu token (USD), kiểm lại trên trang giá chính thức trước khi chốt chi phí. */
export const PRICES = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

export const MODEL_ALIASES = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" };

export function resolveModel(name) {
  return MODEL_ALIASES[name] ?? name;
}

export const VERDICTS = {
  correct: "đúng",
  wrongItem: "SAI MỤC",
  correctHandoff: "chuyển ca đúng",
  extraHandoff: "chuyển ca thừa",
  answeredWithoutKb: "TRẢ LỜI SAI KHI KHO KHÔNG CÓ",
  error: "lỗi AI",
};

/**
 * @param {string|null} expected  slug mong đợi; null/"" = kho không có, bot nên chuyển ca
 * @param {{ok:boolean, slug?:string|null, confidence?:number}} sel
 * @param {number} threshold
 * @param {Set<string>} approved  slug đang approved (mục mong đợi chưa approved thì bot không thể trả lời)
 */
export function judge(expected, sel, threshold, approved) {
  const exp = expected && approved.has(expected) ? expected : null;
  const answered = sel.ok && sel.slug && sel.confidence >= threshold ? sel.slug : null;
  if (!sel.ok) return exp ? VERDICTS.error : VERDICTS.correctHandoff;
  if (!exp) return answered ? VERDICTS.answeredWithoutKb : VERDICTS.correctHandoff;
  if (!answered) return VERDICTS.extraHandoff;
  return answered === exp ? VERDICTS.correct : VERDICTS.wrongItem;
}

export function estimateCost(model, inputTokens, outputTokens) {
  const p = PRICES[model];
  if (!p) return null;
  return (inputTokens * p.input + outputTokens * p.output) / 1e6;
}
