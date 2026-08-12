const groqKey = (process.env.GROQ_API_KEY || "").trim();
const geminiKey = (process.env.GEMINI_API_KEY || "").trim();
const forced = (process.env.LLM_PROVIDER || "").trim().toLowerCase();

/** Prefer Groq when its key is set (or LLM_PROVIDER=groq); else Gemini; else offline mock. */
function resolveProvider() {
  if (forced === "groq" && groqKey) return "groq";
  if (forced === "gemini" && geminiKey) return "gemini";
  if (forced === "mock") return "mock";
  if (groqKey) return "groq";
  if (geminiKey) return "gemini";
  return "mock";
}

const provider = resolveProvider();
const apiKey = provider === "groq" ? groqKey : provider === "gemini" ? geminiKey : "";

const defaultModel =
  provider === "groq"
    ? "llama-3.1-8b-instant"
    : provider === "gemini"
      ? "gemini-2.5-flash"
      : "offline-mock";

const modelEnv = provider === "groq" ? process.env.GROQ_MODEL : process.env.GEMINI_MODEL;

export const config = {
  provider,
  apiKey,
  model: (modelEnv || defaultModel).trim(),

  // Vision-capable Groq model (text models cannot accept images).
  visionModel: (process.env.GROQ_VISION_MODEL || "qwen/qwen3.6-27b").trim(),

  // No usable key -> run fully offline against deterministic mock responses.
  mock: provider === "mock",

  // Per-call network budget. Streaming keeps connections open longer than a
  // plain request, so this is generous rather than tight.
  timeoutMs: intFromEnv("REQUEST_TIMEOUT_MS", 60_000),

  // Retries apply per agent call, not per pipeline run.
  retries: intFromEnv("LLM_RETRIES", 3),

  // Guardrails on user input, enforced before anything reaches the model.
  limits: {
    topicChars: intFromEnv("MAX_TOPIC_CHARS", 2_000),
    referenceChars: intFromEnv("MAX_REFERENCE_CHARS", 20_000),
    imageBytes: intFromEnv("MAX_IMAGE_BYTES", 8 * 1024 * 1024),
  },

  // How many finished runs to keep on disk for the history panel.
  historyLimit: intFromEnv("HISTORY_LIMIT", 25),
};

function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Redacts the key for logs/UI: we surface *that* a key is configured and a few
 * trailing characters so the user can tell which key is loaded, never the key.
 */
export function keyFingerprint() {
  if (!apiKey) return null;
  return `…${apiKey.slice(-4)}`;
}
