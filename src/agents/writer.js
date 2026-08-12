import { complete } from "../llmClient.js";
import { withLanguage } from "../i18n.js";

const SYSTEM = `[[WRITER]] You are the writer agent in a multi-agent research pipeline.
Combine the plan, research findings, and (if present) the image description into a
short, well-structured report (max ~250 words) that directly answers the user's
topic/question. Use plain prose with short paragraphs. If revision feedback is
supplied, address it explicitly in the new draft.`;

/**
 * @returns {Promise<{report: string, usage: object}>}
 */
export async function writeReport({
  topic,
  plan,
  vision,
  research,
  feedback,
  language,
  onDelta,
  onRetry,
  signal,
}) {
  const sections = [
    `Topic: ${topic}`,
    `Plan:\n${plan.join("\n")}`,
    `Research findings:\n${research.findings}`,
  ];

  if (vision) sections.push(`Image description:\n${vision}`);
  if (feedback) sections.push(`Reviewer feedback to address in this revision:\n${feedback}`);

  const { text, usage } = await complete({
    system: withLanguage(SYSTEM, language),
    prompt: `${sections.join("\n\n")}\n\nWrite the report.`,
    maxTokens: 800,
    onDelta,
    onRetry,
    signal,
  });

  return { report: text, usage };
}
