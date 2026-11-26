import { classify as mockClassify } from "./mock-ai.mjs";

export const TOPICS = ["delivery", "pricing", "other"];
export const MODEL_TIMEOUT_MS = 300;

const MANUAL_REVIEW = Object.freeze({ status: "manual_review", topic: null, draft: null });

// Тело запроса -> текст заявки или null, если ввод некорректный.
export function parseInput(rawBody) {
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (body === null || typeof body !== "object") return null;
  const { text } = body;
  if (typeof text !== "string" || text.trim() === "") return null;
  return text;
}

// Ответ модели — это просто строка, ей не доверяем: проверяем JSON, тему и черновик.
export function parseModelOutput(raw) {
  if (typeof raw !== "string") return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (data === null || typeof data !== "object") return null;
  if (!TOPICS.includes(data.topic)) return null;
  if (typeof data.draft !== "string" || data.draft.trim() === "") return null;
  return { topic: data.topic, draft: data.draft.trim() };
}

async function callWithTimeout(classify, text, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("model timeout"));
    }, timeoutMs);
  });
  try {
    // race нужен на случай, если провайдер игнорирует signal
    return await Promise.race([classify(text, { signal: controller.signal }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function triage(text, { classify = mockClassify, timeoutMs = MODEL_TIMEOUT_MS } = {}) {
  let raw;
  try {
    raw = await callWithTimeout(classify, text, timeoutMs);
  } catch (error) {
    console.warn(`[triage] model failed: ${error.message}`);
    return MANUAL_REVIEW;
  }
  const result = parseModelOutput(raw);
  if (!result) {
    console.warn("[triage] model returned unusable output");
    return MANUAL_REVIEW;
  }
  return { status: "ready", ...result };
}
