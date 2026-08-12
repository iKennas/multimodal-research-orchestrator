import { config } from "./config.js";
import {
  EmptyResponseError,
  NetworkError,
  CancelledError,
  PipelineError,
  fromGeminiResponse,
  fromOpenAIResponse,
} from "./errors.js";
import { withRetry, fetchWithTimeout, sleep, throwIfAborted } from "./retry.js";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GROQ_BASE = "https://api.groq.com/openai/v1";

/**
 * Some Groq vision/chat models leak chain-of-thought XML into the answer.
 * Strip that so every agent stage returns user-facing content only.
 */
export function sanitizeModelText(text) {
  return String(text ?? "")
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think\b[^>]*>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * One text generation call.
 *
 * @param {object} options
 * @param {string} options.system              system instruction (carries the [[TAG]] marker)
 * @param {string} options.prompt
 * @param {number} [options.maxTokens=600]
 * @param {(delta: string) => void} [options.onDelta]  called with each streamed text chunk
 * @param {(info: object) => void} [options.onRetry]   called when a retry is scheduled
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{text: string, usage: {promptTokens: number, outputTokens: number, totalTokens: number}}>}
 */
export async function complete({ system, prompt, maxTokens = 600, onDelta, onRetry, signal }) {
  if (config.mock) return mockGenerate({ system, prompt, onDelta, signal });
  return generate({
    system,
    parts: [{ text: prompt }],
    model: config.model,
    maxTokens,
    onDelta,
    onRetry,
    signal,
  });
}

/** Same as complete(), but prepends a base64 image part (multimodal input). */
export async function completeWithImage({
  system,
  prompt,
  imageBase64,
  mediaType,
  maxTokens = 600,
  onDelta,
  onRetry,
  signal,
}) {
  if (config.mock || !imageBase64) {
    return mockGenerate({
      system,
      prompt: `${prompt} [image attached: ${imageBase64 ? "yes" : "no"}]`,
      onDelta,
      signal,
    });
  }

  const model = config.provider === "groq" ? config.visionModel : config.model;

  return generate({
    system,
    parts: [
      { inline_data: { mime_type: mediaType, data: imageBase64 } },
      { text: prompt },
    ],
    model,
    maxTokens,
    onDelta,
    onRetry,
    signal,
  });
}

// ---------------------------------------------------------------------------
// Live provider calls
// ---------------------------------------------------------------------------

async function generate({ system, parts, model, maxTokens, onDelta, onRetry, signal }) {
  const once =
    config.provider === "groq"
      ? () => streamGroqOnce({ system, parts, model, maxTokens, onDelta, signal })
      : () => streamGeminiOnce({ system, parts, model, maxTokens, onDelta, signal });

  const result = await withRetry(once, { retries: config.retries, signal, onRetry });
  const text = sanitizeModelText(result.text);
  if (!text) throw new EmptyResponseError(result.finishReason);
  return { ...result, text };
}

/**
 * A single streaming attempt. Uses Gemini's SSE endpoint so text arrives
 * incrementally - the UI renders it as it lands instead of waiting for the
 * whole agent to finish.
 *
 * Deltas are only emitted once this attempt has produced text. A retry that
 * fires mid-stream would otherwise duplicate what the UI already showed, so
 * the caller is told to reset via the `restart` marker below.
 */
async function streamGeminiOnce({ system, parts, model, maxTokens, onDelta, signal }) {
  const url =
    `${GEMINI_BASE}/${encodeURIComponent(model)}:streamGenerateContent` +
    `?alt=sse&key=${encodeURIComponent(config.apiKey)}`;

  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.7,
      // Gemini 2.5+ spends "thinking" tokens out of the same output budget, which
      // silently truncated agent replies mid-sentence. These agents do short,
      // well-specified tasks and gain nothing from extended reasoning, so it is
      // switched off - the full budget goes to the visible answer.
      ...(supportsThinking(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  };

  let res;
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      { timeoutMs: config.timeoutMs, signal }
    );
  } catch (err) {
    if (err instanceof PipelineError) throw err;
    throw new NetworkError(err.message);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw fromGeminiResponse(res.status, text, model);
  }

  let full = "";
  let usage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 };
  let finishReason = null;
  let emittedAny = false;

  for await (const payload of readSSE(res, signal)) {
    throwIfAborted(signal);

    const candidate = payload.candidates?.[0];
    const chunk = (candidate?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("");

    if (chunk) {
      // First delta of a retried attempt: tell the consumer to discard whatever
      // a previous failed attempt already painted.
      if (!emittedAny) onDelta?.("", { restart: true });
      emittedAny = true;
      full += chunk;
      onDelta?.(chunk);
    }

    if (candidate?.finishReason) finishReason = candidate.finishReason;
    if (payload.usageMetadata) {
      usage = {
        promptTokens: payload.usageMetadata.promptTokenCount ?? 0,
        outputTokens: payload.usageMetadata.candidatesTokenCount ?? 0,
        totalTokens: payload.usageMetadata.totalTokenCount ?? 0,
      };
    }
  }

  const text = full.trim();
  if (!text) {
    // SAFETY / RECITATION / PROHIBITED_CONTENT all land here.
    throw new EmptyResponseError(finishReason);
  }

  return { text, usage, finishReason };
}

/** Groq OpenAI-compatible chat.completions streaming. */
async function streamGroqOnce({ system, parts, model, maxTokens, onDelta, signal }) {
  const userContent = partsToOpenAIContent(parts);

  const body = {
    model,
    temperature: 0.7,
    max_tokens: maxTokens,
    stream: true,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
  };

  let res;
  try {
    res = await fetchWithTimeout(
      `${GROQ_BASE}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      { timeoutMs: config.timeoutMs, signal }
    );
  } catch (err) {
    if (err instanceof PipelineError) throw err;
    throw new NetworkError(err.message);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw fromOpenAIResponse(res.status, text, model);
  }

  let full = "";
  let usage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 };
  let finishReason = null;
  let emittedAny = false;

  for await (const payload of readSSE(res, signal)) {
    throwIfAborted(signal);

    const choice = payload.choices?.[0];
    const chunk = choice?.delta?.content ?? "";

    if (chunk) {
      if (!emittedAny) onDelta?.("", { restart: true });
      emittedAny = true;
      full += chunk;
      onDelta?.(chunk);
    }

    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (payload.usage) {
      usage = {
        promptTokens: payload.usage.prompt_tokens ?? 0,
        outputTokens: payload.usage.completion_tokens ?? 0,
        totalTokens: payload.usage.total_tokens ?? 0,
      };
    }
  }

  const text = full.trim();
  if (!text) throw new EmptyResponseError(finishReason);

  // Groq often omits usage on stream chunks; estimate if missing.
  if (!usage.totalTokens) {
    const outputTokens = Math.ceil(text.length / 4);
    const promptTokens = Math.ceil((system.length + JSON.stringify(userContent).length) / 4);
    usage = { promptTokens, outputTokens, totalTokens: promptTokens + outputTokens };
  }

  return { text, usage, finishReason };
}

/** Convert Gemini-style parts into OpenAI / Groq message content. */
function partsToOpenAIContent(parts) {
  const hasImage = parts.some((p) => p.inline_data);
  if (!hasImage) {
    return parts.map((p) => p.text ?? "").join("\n");
  }

  return parts.map((p) => {
    if (p.inline_data) {
      return {
        type: "image_url",
        image_url: {
          url: `data:${p.inline_data.mime_type};base64,${p.inline_data.data}`,
        },
      };
    }
    return { type: "text", text: p.text ?? "" };
  });
}

/** Only 2.5-and-newer Gemini models accept thinkingConfig; older ones 400 on it. */
function supportsThinking(model) {
  const match = /^gemini-(\d+)(?:\.(\d+))?/.exec(model);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  return major > 2 || (major === 2 && minor >= 5);
}

/**
 * Parses an SSE response body into JSON payloads.
 * Gemini / Groq send `data: {json}` records separated by blank lines.
 */
async function* readSSE(res, signal) {
  if (!res.body) throw new NetworkError("The API returned an empty response body.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const onAbort = () => reader.cancel().catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Records are separated by a blank line; keep the trailing partial.
      const records = buffer.split(/\r?\n\r?\n/);
      buffer = records.pop() ?? "";

      for (const record of records) {
        const json = extractData(record);
        if (json) yield json;
      }
    }

    const tail = extractData(buffer);
    if (tail) yield tail;
  } catch (err) {
    if (signal?.aborted) throw new CancelledError();
    throw err;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock?.();
  }
}

/** Pulls the JSON out of one `data:` SSE record, tolerating multi-line values. */
function extractData(record) {
  const lines = record.split(/\r?\n/).filter((l) => l.startsWith("data:"));
  if (lines.length === 0) return null;

  const raw = lines.map((l) => l.slice(5).trim()).join("");
  if (!raw || raw === "[DONE]") return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null; // partial/keepalive record - safe to skip
  }
}

/**
 * Lists models this key can actually call. Used by the /api/models endpoint and
 * to build a helpful message when the configured model has been retired.
 */
export async function listModels({ signal } = {}) {
  if (config.mock) return [];

  if (config.provider === "groq") {
    const res = await fetchWithTimeout(
      `${GROQ_BASE}/models`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${config.apiKey}` },
      },
      { timeoutMs: 15_000, signal }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw fromOpenAIResponse(res.status, text, config.model);
    }

    const data = await res.json();
    return (data.data ?? []).map((m) => m.id).filter(Boolean);
  }

  const url = `${GEMINI_BASE}?key=${encodeURIComponent(config.apiKey)}&pageSize=200`;
  const res = await fetchWithTimeout(url, { method: "GET" }, { timeoutMs: 15_000, signal });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw fromGeminiResponse(res.status, text, config.model);
  }

  const data = await res.json();
  return (data.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""));
}

// ---------------------------------------------------------------------------
// Offline mock mode
// ---------------------------------------------------------------------------

/**
 * Deterministic offline responses. Each agent's system prompt embeds a [[TAG]]
 * marker so the mock can answer in-character without a network call.
 *
 * The mock streams word by word on purpose: the UI's live-typing animation then
 * behaves identically with and without an API key, which keeps demos honest.
 */
async function mockGenerate({ system, prompt, onDelta, signal }) {
  // Prefer agent tags (PLANNER, …); ignore [[LANG:xx]] which also uses [[…]].
  const tag =
    /\[\[(PLANNER|VISION|RESEARCH|WRITER|REVIEWER|GENERIC)\]\]/.exec(system || "")?.[1] ??
    "GENERIC";
  const lang = /\[\[LANG:(\w+)\]\]/.exec(system || "")?.[1] ?? "tr";
  const text =
    MOCK_RESPONSES[tag]?.(prompt, lang) ?? "[mock] no response configured for this agent.";

  if (onDelta) {
    onDelta("", { restart: true });
    for (const token of text.match(/\S+\s*/g) ?? [text]) {
      throwIfAborted(signal);
      await sleep(18, signal);
      onDelta(token);
    }
  }

  // Rough stand-in so the metrics panel shows plausible numbers offline.
  const outputTokens = Math.ceil(text.length / 4);
  const promptTokens = Math.ceil((system.length + prompt.length) / 4);

  return {
    text,
    usage: { promptTokens, outputTokens, totalTokens: promptTokens + outputTokens },
    finishReason: "STOP",
  };
}

function pickLang(lang, variants) {
  return variants[lang] ?? variants.tr ?? variants.en;
}

const MOCK_RESPONSES = {
  PLANNER: (_prompt, lang) =>
    pickLang(lang, {
      tr: [
        "1. Soruyu netleştir ve iyi bir cevabın neleri kapsaması gerektiğini belirle.",
        "2. Sağlanan metinden anahtar olgular ve anahtar kelimeleri çıkar.",
        "3. Görüntü varsa açıklamasını bulgulara dahil et.",
        "4. Soruyu yanıtlayan kısa bir rapor taslağı yaz.",
        "5. Taslağı özgün soruya karşı gözden geçir.",
      ].join("\n"),
      en: [
        "1. Clarify the exact question and what a good answer must cover.",
        "2. Pull out the key facts and keywords from the supplied material.",
        "3. If an image was supplied, fold its description into the findings.",
        "4. Draft a short report answering the question.",
        "5. Review the draft against the original question before finalizing.",
      ].join("\n"),
      ar: [
        "1. وضّح السؤال بدقة وما يجب أن يغطيه جواب جيد.",
        "2. استخرج الحقائق والكلمات المفتاحية من المادة المقدمة.",
        "3. إذا وُجدت صورة، أدرج وصفها في النتائج.",
        "4. اكتب مسودة تقرير قصير يجيب عن السؤال.",
        "5. راجع المسودة مقابل السؤال الأصلي قبل الإنهاء.",
      ].join("\n"),
    }),

  VISION: (_prompt, lang) =>
    pickLang(lang, {
      tr: "[mock vision] Görüntü alındı ve çözüldü. Çevrimdışı mod gerçek görme analizi yapamaz; bu yer tutucu modelin görüntü açıklamasının yerine geçer.",
      en: "[mock vision] Image received and decoded. Offline mode cannot run real vision analysis, so this placeholder stands in for the model's description of the image.",
      ar: "[mock vision] تم استلام الصورة وفكّها. الوضع دون اتصال لا يشغّل تحليلاً بصرياً حقيقياً، لذا يحل هذا النص محل وصف النموذج للصورة.",
    }),

  RESEARCH: (prompt, lang) => {
    const topic = topicOf(prompt);
    return pickLang(lang, {
      tr:
        `[mock research] Çıkarılan anahtar kelimeler ve istatistiklere göre malzeme şuna odaklanıyor: ${topic}.\n` +
        "- Anahtar kelime aracı yerel olarak çalıştı ve deterministik kanıt üretti.\n" +
        "- Çevrimdışı modda harici bir veri kaynağı sorgulanmadı.",
      en:
        `[mock research] Based on the extracted keywords and statistics, the material centers on: ${topic}.\n` +
        "- The keyword tool ran locally and produced deterministic evidence.\n" +
        "- No external data source was queried in offline mode.",
      ar:
        `[mock research] استناداً إلى الكلمات المفتاحية والإحصاءات المستخرجة، تتمحور المادة حول: ${topic}.\n` +
        "- عملت أداة الكلمات المفتاحية محلياً وأنتجت أدلة حتمية.\n" +
        "- لم يُستعلم أي مصدر بيانات خارجي في الوضع دون اتصال.",
    });
  },

  WRITER: (prompt, lang) => {
    const topic = topicOf(prompt);
    return pickLang(lang, {
      tr:
        `Özet Rapor\n\n${topic} konusu, diğer ajanların topladığı plan ve bulgular kullanılarak aşağıda ele alınmıştır.\n\n` +
        "Temel noktalar:\n" +
        "- Araştırma adımındaki bulgular doğrudan dahil edildi.\n" +
        "- Sağlanan görüntü açıklaması gerektiğinde katıldı.\n" +
        "- Yapı, planlayıcının numaralı adımlarını izler.\n\n" +
        "(Çevrimdışı mock modunda üretildi — canlı model çağrısı yapılmadı.)",
      en:
        `Summary Report\n\n${topic} is addressed below using the plan and findings gathered by the other agents.\n\n` +
        "Key points:\n" +
        "- Findings from the research step were incorporated directly.\n" +
        "- Any supplied image description was folded in where relevant.\n" +
        "- The structure follows the planner's numbered steps.\n\n" +
        "(Generated in offline mock mode - no live model call was made.)",
      ar:
        `تقرير موجز\n\nيُعالَج موضوع ${topic} أدناه باستخدام الخطة والنتائج التي جمعها الوكلاء الآخرون.\n\n` +
        "النقاط الرئيسية:\n" +
        "- أُدرجت نتائج خطوة البحث مباشرة.\n" +
        "- أُدمج وصف الصورة إن وُجد حيث يلزم.\n" +
        "- يتبع الهيكل خطوات المخطّط المرقّمة.\n\n" +
        "(أُنشئ في وضع المحاكاة دون اتصال — لم يُجرَ استدعاء حي للنموذج.)",
    });
  },

  REVIEWER: (_prompt, lang) =>
    pickLang(lang, {
      tr: "STATUS: approved\nREASON: Taslak konuyu kapsıyor ve çevrimdışı mock koşusu için plana yeterince uyuyor.",
      en: "STATUS: approved\nREASON: The draft covers the topic and follows the plan closely enough for an offline mock run.",
      ar: "STATUS: approved\nREASON: المسودة تغطي الموضوع وتتبع الخطة بما يكفي لتشغيل المحاكاة دون اتصال.",
    }),
};

function topicOf(prompt) {
  return /Topic:\s*(.+)/i.exec(prompt)?.[1]?.trim() ?? "the requested topic";
}
