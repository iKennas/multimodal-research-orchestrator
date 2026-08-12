import { complete } from "../llmClient.js";
import { extractKeywords, extractPhrases, basicStats } from "../tools/textTools.js";
import { withLanguage } from "../i18n.js";

const SYSTEM = `[[RESEARCH]] You are the research agent in a multi-agent research pipeline.
You are given the topic plus keyword, phrase and statistic evidence produced by a
deterministic text-analysis tool. Turn that evidence into 2-4 short bullet-point
findings the writer agent can use. Ground every finding in the supplied evidence;
do not invent facts that the evidence does not support.
Use plain text only: numbered or dashed bullets are fine. Do not use Markdown
markers such as **, __, #, ---, or backticks.`;

/**
 * "Research" = run the local text-analysis tool over whatever reference material
 * the user supplied (falling back to the topic itself), then have the model
 * interpret the tool's output. This is the project's tool-integration step: the
 * hard numbers come from code, the interpretation comes from the model.
 *
 * Text-tool methods (extractKeywords / extractPhrases / basicStats) are unchanged.
 * The planner's steps are passed only as structured context for interpretation.
 *
 * @returns {Promise<{keywords: object[], phrases: object[], stats: object, findings: string, usedReference: boolean, usage: object}>}
 */
export async function gatherResearch({ topic, referenceText, plan, language, onDelta, onRetry, signal }) {
  const usedReference = Boolean(referenceText && referenceText.trim().length > 0);
  const source = usedReference ? referenceText : topic;

  const keywords = extractKeywords(source);
  const phrases = extractPhrases(source);
  const stats = basicStats(source);

  const planLines = Array.isArray(plan) && plan.length
    ? plan.map((step, i) => `${i + 1}. ${String(step).replace(/^\s*\d+[.)]\s*/, "")}`).join("\n")
    : "(no plan steps)";

  const evidence = [
    `Topic: ${topic}`,
    `Planner steps the research should support:\n${planLines}`,
    `Evidence source: ${usedReference ? "user-supplied reference text" : "the topic itself (no reference supplied)"}`,
    `Text stats: ${stats.words} words, ${stats.sentences} sentences, ~${stats.avgWordsPerSentence} words/sentence.`,
    `Top keywords: ${keywords.map((k) => `${k.word}(${k.count})`).join(", ") || "none found"}`,
    `Recurring phrases: ${phrases.map((p) => `"${p.phrase}"(${p.count})`).join(", ") || "none found"}`,
  ].join("\n");

  const { text, usage } = await complete({
    system: withLanguage(SYSTEM, language),
    prompt: `${evidence}\n\nWrite the findings. Tie them to the planner steps where the evidence allows.`,
    maxTokens: 500,
    onDelta,
    onRetry,
    signal,
  });

  return { keywords, phrases, stats, findings: text, usedReference, usage };
}
