import { CancelledError, PipelineError, TimeoutError } from "./errors.js";

/**
 * Runs `fn` with exponential backoff + jitter, retrying only errors that are
 * marked retryable (rate limits, 5xx, timeouts, network blips).
 *
 * When the API tells us exactly how long to wait (RateLimitError.retryAfterMs)
 * we honour that instead of our own backoff curve - the free Gemini tier hands
 * out precise retry windows and guessing shorter just burns quota.
 *
 * @param {() => Promise<T>} fn
 * @param {object} options
 * @param {number} [options.retries=3]      extra attempts after the first
 * @param {number} [options.baseDelayMs=800]
 * @param {number} [options.maxDelayMs=20000]
 * @param {AbortSignal} [options.signal]
 * @param {(info: {attempt: number, delayMs: number, error: PipelineError}) => void} [options.onRetry]
 * @returns {Promise<T>}
 * @template T
 */
export async function withRetry(fn, {
  retries = 3,
  baseDelayMs = 800,
  maxDelayMs = 20000,
  signal,
  onRetry,
} = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    throwIfAborted(signal);
    try {
      return await fn();
    } catch (err) {
      if (err instanceof CancelledError) throw err;
      lastError = err;

      const retryable = err instanceof PipelineError ? err.retryable : false;
      if (!retryable || attempt === retries) throw err;

      // Prefer the server's own retry window when it gave us one.
      const serverDelay = typeof err.retryAfterMs === "number" ? err.retryAfterMs : 0;
      const backoff = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      const jitter = Math.random() * 0.3 * backoff; // spreads out concurrent agents
      const delayMs = Math.max(serverDelay, backoff + jitter);

      onRetry?.({ attempt: attempt + 1, delayMs, error: err });
      await sleep(delayMs, signal);
    }
  }

  throw lastError;
}

/** Promise-based sleep that rejects immediately if the run is cancelled. */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(new CancelledError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Wraps fetch with a hard timeout, translating an aborted-by-timeout into a
 * TimeoutError while letting a genuine user cancellation propagate as such.
 *
 * @param {string} url
 * @param {RequestInit} init
 * @param {object} options
 * @param {number} options.timeoutMs
 * @param {AbortSignal} [options.signal] user cancellation
 */
export async function fetchWithTimeout(url, init, { timeoutMs, signal }) {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onUserAbort = () => controller.abort();
  signal?.addEventListener("abort", onUserAbort, { once: true });

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (signal?.aborted) throw new CancelledError();
    if (timedOut) throw new TimeoutError(timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onUserAbort);
  }
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw new CancelledError();
}
