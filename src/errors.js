/**
 * Typed errors for the pipeline.
 *
 * Every failure the system can hit is mapped to one of these so the CLI and the
 * web UI can show an actionable message instead of a raw stack trace, and so the
 * retry layer knows what is worth retrying.
 */

export class PipelineError extends Error {
  /**
   * @param {string} message   human-readable, actionable
   * @param {object} options
   * @param {string} options.code      stable machine code (shown in the UI/log)
   * @param {boolean} options.retryable whether retrying could plausibly help
   * @param {string} [options.hint]    what the user should actually do about it
   * @param {number} [options.status]  HTTP status, when the failure came from an API
   */
  constructor(message, { code, retryable = false, hint, status } = {}) {
    super(message);
    this.name = "PipelineError";
    this.code = code || "unknown_error";
    this.retryable = retryable;
    this.hint = hint;
    this.status = status;
  }

  /** Shape sent to the browser - never includes secrets or stack traces. */
  toJSON() {
    return { code: this.code, message: this.message, hint: this.hint, status: this.status };
  }
}

export class AuthError extends PipelineError {
  constructor(message = "The API rejected the key.") {
    super(message, {
      code: "auth_error",
      retryable: false,
      status: 401,
      hint: "Check GROQ_API_KEY or GEMINI_API_KEY in your .env file.",
    });
    this.name = "AuthError";
  }
}

export class RateLimitError extends PipelineError {
  /** @param {number} retryAfterMs how long the API asked us to wait */
  constructor(message = "Rate limit reached.", retryAfterMs = 0) {
    super(message, {
      code: "rate_limit",
      retryable: true,
      status: 429,
      hint: "The free tier allows only a few requests per minute. The pipeline retries automatically.",
    });
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class ModelNotFoundError extends PipelineError {
  constructor(model, available = []) {
    const suggestion = available.length
      ? ` Available models include: ${available.slice(0, 5).join(", ")}.`
      : "";
    super(`Model "${model}" is not available.${suggestion}`, {
      code: "model_not_found",
      retryable: false,
      status: 404,
      hint: "Set GROQ_MODEL / GEMINI_MODEL in .env to a model your key can access.",
    });
    this.name = "ModelNotFoundError";
    this.available = available;
  }
}

/** The model returned nothing usable - usually a safety filter or an empty candidate. */
export class EmptyResponseError extends PipelineError {
  constructor(reason) {
    super(
      reason
        ? `The model returned no usable text (reason: ${reason}).`
        : "The model returned no usable text.",
      {
        code: "empty_response",
        retryable: false,
        hint: "Try rephrasing the topic. Safety filters can block some prompts or images.",
      }
    );
    this.name = "EmptyResponseError";
    this.reason = reason;
  }
}

export class TimeoutError extends PipelineError {
  constructor(ms) {
    super(`The request timed out after ${Math.round(ms / 1000)}s.`, {
      code: "timeout",
      retryable: true,
      hint: "The model took too long to respond. The pipeline retries automatically.",
    });
    this.name = "TimeoutError";
  }
}

export class NetworkError extends PipelineError {
  constructor(message = "Could not reach the API.") {
    super(message, {
      code: "network_error",
      retryable: true,
      hint: "Check your internet connection.",
    });
    this.name = "NetworkError";
  }
}

/** Raised when the user cancels a run. Never retried, never surfaced as a failure. */
export class CancelledError extends PipelineError {
  constructor() {
    super("Run cancelled.", { code: "cancelled", retryable: false });
    this.name = "CancelledError";
  }
}

export class ValidationError extends PipelineError {
  constructor(message, hint) {
    super(message, { code: "validation_error", retryable: false, status: 400, hint });
    this.name = "ValidationError";
  }
}

/**
 * Maps a Gemini HTTP error response onto one of the typed errors above.
 * @param {number} status
 * @param {string} bodyText raw response body
 * @param {string} model    model that was requested
 */
export function fromGeminiResponse(status, bodyText, model) {
  return fromProviderResponse(status, bodyText, model, "gemini");
}

/**
 * Maps an OpenAI-compatible (Groq) HTTP error onto typed pipeline errors.
 */
export function fromOpenAIResponse(status, bodyText, model) {
  return fromProviderResponse(status, bodyText, model, "openai");
}

function fromProviderResponse(status, bodyText, model, flavor) {
  let parsed = null;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    // Non-JSON error body - fall through to the generic branches below.
  }
  const apiMessage = parsed?.error?.message || bodyText.slice(0, 300);

  if (status === 400 && /API key not valid|invalid.*api.?key|incorrect api key/i.test(apiMessage)) {
    return new AuthError();
  }
  if (status === 401 || status === 403) return new AuthError(apiMessage);

  if (status === 429) {
    let seconds = 0;
    if (flavor === "gemini") {
      // Gemini returns a RetryInfo detail like { retryDelay: "19s" }.
      const detail = parsed?.error?.details?.find((d) => d["@type"]?.includes("RetryInfo"));
      seconds = parseFloat(detail?.retryDelay ?? "") || parseRetrySeconds(apiMessage);
    } else {
      // Groq / OpenAI often put seconds in the message or a retry-after style field.
      seconds =
        parseRetrySeconds(apiMessage) ||
        Number.parseFloat(parsed?.error?.code === "rate_limit_exceeded" ? "5" : "0") ||
        5;
    }
    return new RateLimitError(
      "Rate limit reached (free tier allows a few requests per minute).",
      seconds * 1000
    );
  }

  if (status === 404 || (status === 400 && /model|does not exist|not found/i.test(apiMessage))) {
    return new ModelNotFoundError(model);
  }

  if (status >= 500) {
    return new PipelineError(`The API is temporarily unavailable (HTTP ${status}).`, {
      code: "server_error",
      retryable: true,
      status,
      hint: "This is on the provider's side. The pipeline retries automatically.",
    });
  }

  return new PipelineError(apiMessage || `API error ${status}.`, {
    code: "api_error",
    retryable: false,
    status,
  });
}

/** Pulls "retry in 19.2s" style hints out of a free-text message. */
function parseRetrySeconds(message) {
  const match = /retry in ([\d.]+)s/i.exec(message || "");
  return match ? parseFloat(match[1]) : 0;
}
