/**
 * Deterministic, LLM-free text analysis.
 *
 * This is the pipeline's "tool": the research agent calls it to get hard
 * evidence, then asks the model to interpret that evidence. Keeping it
 * deterministic means the same input always produces the same numbers, which
 * is what makes the research step testable without a network call.
 */

// Stopwords for languages the project supports (English + Turkish + Arabic).
// extractKeywords / extractPhrases / basicStats method signatures stay the same.
const STOPWORDS = new Set([
  // English
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "is",
  "are", "was", "were", "be", "been", "being", "with", "as", "at", "by", "it",
  "its", "this", "that", "these", "those", "from", "into", "about", "how",
  "what", "why", "when", "where", "which", "who", "can", "could", "would",
  "should", "will", "shall", "may", "might", "must", "have", "has", "had",
  "do", "does", "did", "not", "no", "yes", "if", "then", "than", "so", "such",
  "there", "their", "them", "they", "we", "you", "your", "our", "us", "he",
  "she", "his", "her", "him", "i", "me", "my", "all", "any", "each", "more",
  "most", "other", "some", "only", "own", "same", "too", "very", "just",
  // Turkish
  "ve", "veya", "ile", "bir", "bu", "şu", "o", "için", "gibi", "daha", "çok",
  "az", "ama", "fakat", "ancak", "de", "da", "ki", "ise", "olan", "olarak",
  "üzere", "kadar", "sonra", "önce", "her", "hiç", "bazı", "kendi", "ne",
  "nasıl", "neden", "niçin", "hangi", "değil", "var", "yok", "en",
  // Arabic (methods unchanged — stopword list only)
  "في", "من", "إلى", "على", "هذا", "هذه", "ذلك", "تلك", "التي", "الذي",
  "أن", "إن", "كان", "كانت", "يكون", "ما", "لا", "لم", "لن", "قد", "عن",
  "مع", "أو", "و", "ثم", "كل", "بعض", "أي", "هو", "هي", "هم", "نحن", "أنا",
  "أنت", "أنتم", "بين", "بعد", "قبل", "عند", "حتى", "كيف", "ماذا", "لماذا",
  "أين", "متى", "هل", "إذا", "أيضا", "فقط", "هناك",
]);

/** Word-frequency keyword extraction. */
export function extractKeywords(text, topN = 8) {
  const counts = new Map();
  for (const word of tokenize(text)) {
    counts.set(word, (counts.get(word) || 0) + 1);
  }

  return [...counts.entries()]
    // Frequency first, then alphabetically so ties are stable across runs.
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));
}

/**
 * Most frequent adjacent word pairs. Surfaces multi-word concepts
 * ("multi agent", "agent orchestration") that single keywords miss.
 */
export function extractPhrases(text, topN = 5) {
  const words = tokenize(text);
  const counts = new Map();

  for (let i = 0; i < words.length - 1; i++) {
    const phrase = `${words[i]} ${words[i + 1]}`;
    counts.set(phrase, (counts.get(phrase) || 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1) // a pair seen once isn't a theme
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([phrase, count]) => ({ phrase, count }));
}

/** Word/sentence/character counts plus a rough readability signal. */
export function basicStats(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?…]+/).filter((s) => s.trim().length > 0);
  const avgWordsPerSentence = sentences.length > 0 ? words.length / sentences.length : 0;

  return {
    characters: text.length,
    words: words.length,
    sentences: sentences.length,
    avgWordsPerSentence: Number(avgWordsPerSentence.toFixed(1)),
    readingTimeSeconds: Math.max(1, Math.round((words.length / 200) * 60)),
  };
}

function tokenize(text) {
  const matches = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return matches.filter((w) => w.length > 2 && !STOPWORDS.has(w));
}
