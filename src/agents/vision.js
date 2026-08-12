import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { completeWithImage } from "../llmClient.js";
import { config } from "../config.js";
import { ValidationError } from "../errors.js";
import { withLanguage } from "../i18n.js";

const SYSTEM = `[[VISION]] You are the vision agent in a multi-agent research pipeline.
Describe the supplied image factually in 2-4 sentences, focusing on details that
are relevant to the user's topic/question. Do not speculate beyond what is visible.
Reply with the description only — no chain-of-thought, no XML/HTML tags, no preamble.`;

const MEDIA_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export const SUPPORTED_IMAGE_TYPES = Object.values(MEDIA_TYPES);

/**
 * Returns null when no image is supplied - the orchestrator then skips this step.
 * @returns {Promise<{description: string, usage: object}|null>}
 */
export async function analyzeImage({ imagePath, topic, language, onDelta, onRetry, signal }) {
  if (!imagePath) return null;

  const ext = path.extname(imagePath).toLowerCase();
  const mediaType = MEDIA_TYPES[ext];
  if (!mediaType) {
    throw new ValidationError(
      `Unsupported image type "${ext || "unknown"}".`,
      `Supported formats: ${Object.keys(MEDIA_TYPES).join(", ")}`
    );
  }

  const { size } = await stat(imagePath);
  if (size > config.limits.imageBytes) {
    const limitMb = (config.limits.imageBytes / (1024 * 1024)).toFixed(1);
    throw new ValidationError(
      `Image is too large (${(size / (1024 * 1024)).toFixed(1)} MB).`,
      `The limit is ${limitMb} MB. Try resizing the image.`
    );
  }

  const buffer = await readFile(imagePath);
  const { text, usage } = await completeWithImage({
    system: withLanguage(SYSTEM, language),
    prompt: `Topic: ${topic}\n\nDescribe this image with the topic in mind.`,
    imageBase64: buffer.toString("base64"),
    mediaType,
    maxTokens: 400,
    onDelta,
    onRetry,
    signal,
  });

  return { description: text, usage };
}
