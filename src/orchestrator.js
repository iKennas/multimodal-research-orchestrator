import { planTask } from "./agents/planner.js";
import { analyzeImage } from "./agents/vision.js";
import { gatherResearch } from "./agents/research.js";
import { writeReport } from "./agents/writer.js";
import { reviewReport } from "./agents/reviewer.js";
import { config } from "./config.js";
import { CancelledError, ValidationError, PipelineError } from "./errors.js";
import { throwIfAborted } from "./retry.js";
import { normalizeLanguage } from "./i18n.js";

export const AGENT_CHAIN = ["planner", "vision", "research", "writer", "reviewer"];

/** Hard ceiling on revision rounds so a picky reviewer can never loop forever. */
const MAX_REVISIONS = 2;

/**
 * Runs the fixed multi-agent pipeline:
 *
 *   plan -> [vision, if an image was supplied] -> research -> write -> review
 *
 * If the reviewer asks for changes the pipeline does NOT silently rewrite. It
 * calls `onApprovalNeeded` so a human decides whether to accept the draft or
 * send it back - the project's human-in-the-loop authority boundary.
 *
 * @param {object} options
 * @param {string} options.topic
 * @param {string} [options.imagePath]
 * @param {string} [options.referenceText]
 * @param {string} [options.language]  tr | en | ar (default tr)
 * @param {(review) => Promise<boolean>} [options.onApprovalNeeded] true = accept draft as-is
 * @param {(event) => void} [options.onStep]  progress events for the UI
 * @param {AbortSignal} [options.signal]
 */
export async function runOrchestration({
  topic,
  imagePath,
  referenceText,
  language,
  onApprovalNeeded,
  onStep,
  signal,
}) {
  validateInputs({ topic, referenceText });
  const lang = normalizeLanguage(language);

  const startedAt = Date.now();
  const metrics = { agents: {}, usage: { promptTokens: 0, outputTokens: 0, totalTokens: 0 }, retries: 0 };

  const emit = (agent, phase, data) => onStep?.({ agent, phase, data });

  /**
   * Wraps one agent call with timing, token accounting, delta streaming and
   * uniform start/end/error events, so every agent behaves identically to the UI.
   */
  const runAgent = async (agent, fn, { revision = false } = {}) => {
    throwIfAborted(signal);
    const t0 = Date.now();
    emit(agent, "start", revision ? { revision } : undefined);

    const ctx = {
      signal,
      onDelta: (delta, meta) => emit(agent, "delta", { delta, ...meta }),
      onRetry: ({ attempt, delayMs, error }) => {
        metrics.retries++;
        emit(agent, "retry", {
          attempt,
          delayMs,
          code: error.code,
          message: error.message,
        });
      },
    };

    try {
      const result = await fn(ctx);
      const durationMs = Date.now() - t0;

      const usage = result?.usage ?? { promptTokens: 0, outputTokens: 0, totalTokens: 0 };
      metrics.usage.promptTokens += usage.promptTokens ?? 0;
      metrics.usage.outputTokens += usage.outputTokens ?? 0;
      metrics.usage.totalTokens += usage.totalTokens ?? 0;

      // Repeat passes accumulate rather than overwrite the first measurement.
      const prior = metrics.agents[agent];
      metrics.agents[agent] = {
        durationMs: (prior?.durationMs ?? 0) + durationMs,
        tokens: (prior?.tokens ?? 0) + (usage.totalTokens ?? 0),
        calls: (prior?.calls ?? 0) + 1,
      };

      emit(agent, "end", { result, durationMs, usage });
      return result;
    } catch (err) {
      if (err instanceof CancelledError) throw err;
      emit(agent, "error", {
        code: err instanceof PipelineError ? err.code : "unknown_error",
        message: err.message,
        hint: err instanceof PipelineError ? err.hint : undefined,
      });
      throw err;
    }
  };

  // --- 1. Plan ------------------------------------------------------------
  const { steps: plan } = await runAgent("planner", (ctx) =>
    planTask({ topic, language: lang, ...ctx })
  );

  // --- 2. Vision (conditional branch) -------------------------------------
  let vision = null;
  if (imagePath) {
    const result = await runAgent("vision", (ctx) =>
      analyzeImage({ imagePath, topic, language: lang, ...ctx })
    );
    vision = result?.description ?? null;
  } else {
    emit("vision", "skip", { reason: "no image supplied" });
  }

  // --- 3. Research (tool + model, steered by the planner's steps) ---------
  const research = await runAgent("research", (ctx) =>
    gatherResearch({ topic, referenceText, plan, language: lang, ...ctx })
  );

  // --- 4. Write -----------------------------------------------------------
  let { report } = await runAgent("writer", (ctx) =>
    writeReport({ topic, plan, vision, research, language: lang, ...ctx })
  );

  // --- 5. Review, with a human gate on any revision -----------------------
  let review = await runAgent("reviewer", (ctx) =>
    reviewReport({ topic, report, language: lang, ...ctx })
  );

  let revisions = 0;
  while (review.status === "needs_revision" && revisions < MAX_REVISIONS) {
    throwIfAborted(signal);

    emit("human", "approval-needed", { reason: review.reason, revisionsSoFar: revisions });
    // No handler (tests / non-interactive runs) means "don't accept, revise once".
    const acceptAsIs = onApprovalNeeded ? await onApprovalNeeded(review) : false;
    emit("human", "approval-resolved", { acceptAsIs });

    if (acceptAsIs) break;

    revisions++;
    ({ report } = await runAgent(
      "writer",
      (ctx) =>
        writeReport({
          topic,
          plan,
          vision,
          research,
          feedback: review.reason,
          language: lang,
          ...ctx,
        }),
      { revision: true }
    ));
    review = await runAgent(
      "reviewer",
      (ctx) => reviewReport({ topic, report, language: lang, ...ctx }),
      { revision: true }
    );
  }

  const hitRevisionLimit = review.status === "needs_revision" && revisions >= MAX_REVISIONS;

  return {
    topic,
    language: lang,
    plan,
    vision,
    research,
    report,
    review,
    revisions,
    revised: revisions > 0,
    hitRevisionLimit,
    metrics: { ...metrics, totalDurationMs: Date.now() - startedAt },
    mock: config.mock,
    model: config.mock ? "offline-mock" : config.model,
    finishedAt: new Date().toISOString(),
  };
}

function validateInputs({ topic, referenceText }) {
  if (!topic || !topic.trim()) {
    throw new ValidationError("A topic/question is required.", "Type a question to run the pipeline.");
  }
  if (topic.length > config.limits.topicChars) {
    throw new ValidationError(
      `Topic is too long (${topic.length} characters).`,
      `The limit is ${config.limits.topicChars} characters.`
    );
  }
  if (referenceText && referenceText.length > config.limits.referenceChars) {
    throw new ValidationError(
      `Reference text is too long (${referenceText.length} characters).`,
      `The limit is ${config.limits.referenceChars} characters. Trim the material and try again.`
    );
  }
}
