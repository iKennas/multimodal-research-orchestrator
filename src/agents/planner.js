import { complete } from "../llmClient.js";
import { withLanguage } from "../i18n.js";

const SYSTEM = `[[PLANNER]] You are the planning agent in a multi-agent research pipeline.
Given a user's topic/question, output a short numbered plan (3-6 steps) describing
how the other agents should gather information and produce a final report.
Reply with the numbered list only, one step per line. No preamble, no commentary.`;

/**
 * @returns {Promise<{steps: string[], usage: object}>}
 */
export async function planTask({ topic, language, onDelta, onRetry, signal }) {
  const { text, usage } = await complete({
    system: withLanguage(SYSTEM, language),
    prompt: `Topic: ${topic}\n\nProduce the numbered plan.`,
    maxTokens: 500,
    onDelta,
    onRetry,
    signal,
  });

  const steps = text
    .split("\n")
    .map((line) => line.trim())
    // Drop stray markdown fences or bare prose the model sometimes prefixes.
    .filter((line) => line.length > 0 && !/^```/.test(line));

  // If the model ignored the format entirely, keep the raw text as one step
  // rather than handing an empty plan to the writer.
  return { steps: steps.length > 0 ? steps : [text.trim()], usage };
}
