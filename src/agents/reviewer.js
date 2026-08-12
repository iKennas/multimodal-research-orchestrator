import { complete } from "../llmClient.js";
import { withLanguage } from "../i18n.js";

const SYSTEM = `[[REVIEWER]] You are the reviewer agent in a multi-agent research pipeline.
Default to approval. Approve whenever the draft substantially addresses the topic and is
coherent enough to ship. Minor style, length, or completeness nits are NOT grounds for rejection.

Request revision ONLY for clear failures: empty/near-empty text, completely off-topic content,
or a major contradiction with the research findings.

Reply with EXACTLY two lines and nothing else. Prefer this happy-path format:

STATUS: approved
REASON: <one short sentence>

Use STATUS: needs_revision only for a clear failure:

STATUS: needs_revision
REASON: <one short sentence naming the specific problem to fix>`;

/**
 * @returns {Promise<{status: "approved"|"needs_revision", reason: string, raw: string, parsed: boolean, usage: object}>}
 */
export async function reviewReport({ topic, report, language, onDelta, onRetry, signal }) {
  const { text, usage } = await complete({
    system: withLanguage(SYSTEM, language, { keepStatusEnglish: true }),
    prompt: `Topic: ${topic}\n\nDraft report:\n${report}\n\nEvaluate it. Default STATUS: approved unless there is a clear failure.`,
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
    // Broken format: only reject on strong, explicit failure signals — never on the
    // mere word "revision" (models often echo the STATUS template).
    parsed = false;
    const strongReject =
      /\b(STATUS:\s*needs[_\s-]?revision|must\s+revise|reject(?:ed|ion)?|off[-\s]?topic|empty|near[-\s]?empty|does not address|doesn't address)\b/i.test(
        text
      );
    status = strongReject ? "needs_revision" : "approved";
  }

  return {
    status,
    reason: reasonMatch?.[1]?.trim() ?? (parsed ? "" : "Reviewer response could not be parsed; defaulted to approved."),
    raw: text,
    parsed,
    usage,
  };
}
