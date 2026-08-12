import { complete } from "../llmClient.js";
import { withLanguage } from "../i18n.js";

const SYSTEM = `[[REVIEWER]] You are the reviewer agent in a multi-agent research pipeline.
Judge whether the draft is a usable answer to the topic/question. Prefer approval when the
report substantially addresses the topic and is coherent enough to ship.
Only request revision for clear failures: off-topic content, empty/near-empty text, or a
major contradiction with the research findings. Minor style, length, or completeness
nits are not enough to reject. Reply in exactly this format and nothing else:
STATUS: approved
REASON: <one short sentence>

or

STATUS: needs_revision
REASON: <one short sentence naming the specific problem to fix>`;

/**
 * @returns {Promise<{status: "approved"|"needs_revision", reason: string, raw: string, parsed: boolean, usage: object}>}
 */
export async function reviewReport({ topic, report, language, onDelta, onRetry, signal }) {
  const { text, usage } = await complete({
    system: withLanguage(SYSTEM, language, { keepStatusEnglish: true }),
    prompt: `Topic: ${topic}\n\nDraft report:\n${report}\n\nEvaluate it.`,
    maxTokens: 300,
    onDelta,
    onRetry,
    signal,
  });

  const statusMatch = /STATUS:\s*(approved|needs[_\s-]?revision)/i.exec(text);
  const reasonMatch = /REASON:\s*(.+)/i.exec(text);

  let status;
  let parsed = true;

  if (statusMatch) {
    status = /needs/i.test(statusMatch[1]) ? "needs_revision" : "approved";
  } else {
    // The model broke format. Rather than silently approving, look for negative
    // signals in the free text and fall back to approval only if none are found.
    parsed = false;
    status = /\b(revise|revision|reject|insufficient|does not|doesn't|missing|fails?)\b/i.test(text)
      ? "needs_revision"
      : "approved";
  }

  return {
    status,
    reason: reasonMatch?.[1]?.trim() ?? (parsed ? "" : "Reviewer response could not be parsed."),
    raw: text,
    parsed,
    usage,
  };
}
