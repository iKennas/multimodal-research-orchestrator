/**
 * Pipeline output language helpers.
 * UI chrome has its own catalog in public/i18n.js; this module only steers
 * agent prompts so plans/findings/reports match the user's selection.
 */

export const SUPPORTED_LANGUAGES = ["tr", "en", "ar"];
export const DEFAULT_LANGUAGE = "tr";

export const LANGUAGE_META = {
  tr: { name: "Turkish", native: "Türkçe", dir: "ltr", locale: "tr-TR" },
  en: { name: "English", native: "English", dir: "ltr", locale: "en-US" },
  ar: { name: "Arabic", native: "العربية", dir: "rtl", locale: "ar" },
};

/** Coerce any user/API value to a supported language code (default Turkish). */
export function normalizeLanguage(value) {
  const code = String(value ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 2);
  return SUPPORTED_LANGUAGES.includes(code) ? code : DEFAULT_LANGUAGE;
}

/**
 * Appends a language directive to an agent system prompt.
 * Reviewer STATUS keywords stay English so the parser keeps working.
 */
export function withLanguage(system, language, { keepStatusEnglish = false } = {}) {
  const code = normalizeLanguage(language);
  const meta = LANGUAGE_META[code];
  const statusNote = keepStatusEnglish
    ? " Keep STATUS line keywords exactly as `approved` or `needs_revision` (English). Write the REASON text in the output language."
    : "";

  return (
    `${system}\n\n` +
    `[[LANG:${code}]] Output language: ${meta.name} (${code}). ` +
    `Write all user-facing content (plans, findings, reports, descriptions, reasons) in ${meta.name}. ` +
    `Do not switch languages unless quoting source material.${statusNote}`
  );
}
