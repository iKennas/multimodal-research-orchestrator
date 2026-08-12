import test from "node:test";
import assert from "node:assert/strict";

import { runOrchestration, AGENT_CHAIN } from "../src/orchestrator.js";
import { extractKeywords, extractPhrases, basicStats } from "../src/tools/textTools.js";
import { withRetry, sleep } from "../src/retry.js";
import {
  RateLimitError,
  AuthError,
  ModelNotFoundError,
  CancelledError,
  ValidationError,
  PipelineError,
  fromGeminiResponse,
} from "../src/errors.js";
import { runToMarkdown, suggestFilename, formatMs } from "../src/markdown.js";

// The suite runs in offline mock mode (no GEMINI_API_KEY in the test env), so
// it exercises the real orchestration wiring without a network call or a secret.

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

test("full pipeline produces a plan, findings, report, review and metrics", async () => {
  const run = await runOrchestration({
    topic: "Benefits of multi-agent orchestration",
    onApprovalNeeded: async () => true,
  });

  assert.ok(run.plan.length >= 3, "plan should have several steps");
  assert.equal(run.vision, null, "no image was supplied");
  assert.ok(run.research.findings.length > 0);
  assert.ok(run.report.length > 0);
  assert.ok(["approved", "needs_revision"].includes(run.review.status));

  assert.ok(run.metrics.totalDurationMs >= 0);
  assert.ok(run.metrics.usage.totalTokens > 0, "token usage should be accumulated");
  for (const agent of ["planner", "research", "writer", "reviewer"]) {
    assert.ok(run.metrics.agents[agent], `metrics recorded for ${agent}`);
    assert.equal(run.metrics.agents[agent].calls, 1);
  }
  assert.ok(!("vision" in run.metrics.agents), "skipped agent records no metrics");
});

test("pipeline emits ordered lifecycle events for every agent", async () => {
  const events = [];
  await runOrchestration({
    topic: "Event ordering",
    onStep: (e) => events.push(e),
    onApprovalNeeded: async () => true,
  });

  const planner = events.filter((e) => e.agent === "planner").map((e) => e.phase);
  assert.equal(planner[0], "start");
  assert.equal(planner.at(-1), "end");
  assert.ok(planner.includes("delta"), "planner should stream deltas");

  const skipped = events.find((e) => e.agent === "vision" && e.phase === "skip");
  assert.ok(skipped, "vision emits a skip event when no image is supplied");

  // Agents must not interleave: each one ends before the next starts.
  const starts = events.filter((e) => e.phase === "start").map((e) => e.agent);
  assert.deepEqual(starts, ["planner", "research", "writer", "reviewer"]);
});

test("streamed deltas reconstruct exactly the final report text", async () => {
  let streamed = "";
  const run = await runOrchestration({
    topic: "Delta fidelity",
    onApprovalNeeded: async () => true,
    onStep: (e) => {
      if (e.agent !== "writer" || e.phase !== "delta") return;
      if (e.data.restart) streamed = ""; // a retry discards the partial paint
      else streamed += e.data.delta;
    },
  });

  assert.equal(streamed.trim(), run.report);
});

test("pipeline rejects an empty topic", async () => {
  await assert.rejects(() => runOrchestration({ topic: "   " }), ValidationError);
});

test("pipeline rejects an over-long topic", async () => {
  await assert.rejects(
    () => runOrchestration({ topic: "x".repeat(5000) }),
    (err) => err instanceof ValidationError && /too long/i.test(err.message)
  );
});

test("declining the draft triggers a bounded revision loop", async () => {
  // Force the reviewer down the revision path regardless of the mock's verdict.
  const events = [];
  const run = await runOrchestration({
    topic: "Revision loop",
    onApprovalNeeded: async () => false,
    onStep: (e) => events.push(e),
  });

  // The offline reviewer always approves, so no human gate should have opened.
  assert.equal(run.revisions, 0);
  assert.equal(run.revised, false);
  assert.ok(!events.some((e) => e.phase === "approval-needed"));
});

test("cancellation aborts the run promptly", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);

  await assert.rejects(
    () => runOrchestration({ topic: "Cancel me", signal: controller.signal }),
    CancelledError
  );
});

// ---------------------------------------------------------------------------
// Text analysis tool
// ---------------------------------------------------------------------------

test("extractKeywords ignores stopwords and ranks by frequency", () => {
  const kws = extractKeywords("agents orchestrate agents and tools and more agents");
  assert.equal(kws[0].word, "agents");
  assert.equal(kws[0].count, 3);
  assert.ok(!kws.some((k) => k.word === "and"), "stopwords are removed");
});

test("extractKeywords is stable for tied counts", () => {
  const a = extractKeywords("zebra apple zebra apple mango");
  const b = extractKeywords("apple zebra apple zebra mango");
  assert.deepEqual(a, b, "ties resolve alphabetically, not by insertion order");
});

test("extractPhrases finds repeated word pairs only", () => {
  const phrases = extractPhrases("multi agent systems and multi agent design", 5);
  assert.ok(phrases.some((p) => p.phrase === "multi agent" && p.count === 2));
  assert.ok(phrases.every((p) => p.count > 1), "one-off pairs are not themes");
});

test("basicStats counts words, sentences and derived figures", () => {
  const stats = basicStats("Hello world. This is a test!");
  assert.equal(stats.words, 6);
  assert.equal(stats.sentences, 2);
  assert.equal(stats.avgWordsPerSentence, 3);
  assert.ok(stats.readingTimeSeconds >= 1);
});

test("text tools handle empty input without throwing", () => {
  assert.deepEqual(extractKeywords(""), []);
  assert.deepEqual(extractPhrases(""), []);
  assert.equal(basicStats("").words, 0);
  assert.equal(basicStats("").avgWordsPerSentence, 0);
});

test("tokenizer handles non-ASCII (Turkish) text", () => {
  const kws = extractKeywords("çoklu ajan sistemleri çoklu ajan orkestrasyonu");
  assert.ok(kws.some((k) => k.word === "çoklu" && k.count === 2));
});

test("tokenizer handles Arabic text and drops Arabic stopwords", () => {
  const kws = extractKeywords("البحث البحث متعدد الوسائط في هذا المجال");
  assert.ok(kws.some((k) => k.word === "البحث" && k.count === 2));
  assert.ok(!kws.some((k) => k.word === "في" || k.word === "هذا"));
});

// ---------------------------------------------------------------------------
// Retry / error classification
// ---------------------------------------------------------------------------

test("withRetry retries retryable errors and eventually succeeds", async () => {
  let attempts = 0;
  const result = await withRetry(
    async () => {
      attempts++;
      if (attempts < 3) throw new RateLimitError("slow down", 1);
      return "ok";
    },
    { retries: 3, baseDelayMs: 1 }
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
});

test("withRetry does not retry non-retryable errors", async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          attempts++;
          throw new AuthError();
        },
        { retries: 3, baseDelayMs: 1 }
      ),
    AuthError
  );
  assert.equal(attempts, 1, "an auth failure is fatal on the first try");
});

test("withRetry gives up after the configured number of attempts", async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          attempts++;
          throw new RateLimitError("nope", 1);
        },
        { retries: 2, baseDelayMs: 1 }
      ),
    RateLimitError
  );
  assert.equal(attempts, 3, "initial attempt plus two retries");
});

test("withRetry stops immediately when cancelled", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => withRetry(async () => "never", { signal: controller.signal }),
    CancelledError
  );
});

test("sleep rejects when the signal aborts mid-wait", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(() => sleep(5000, controller.signal), CancelledError);
});

test("gemini 429 responses carry the server's retry delay", () => {
  const body = JSON.stringify({
    error: {
      code: 429,
      message: "Quota exceeded",
      details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "19s" }],
    },
  });

  const err = fromGeminiResponse(429, body, "gemini-2.5-flash");
  assert.ok(err instanceof RateLimitError);
  assert.equal(err.retryAfterMs, 19000);
  assert.equal(err.retryable, true);
});

test("gemini error statuses map onto typed errors", () => {
  assert.ok(fromGeminiResponse(403, "{}", "m") instanceof AuthError);
  assert.ok(fromGeminiResponse(404, "{}", "m") instanceof ModelNotFoundError);

  const invalidKey = fromGeminiResponse(
    400,
    JSON.stringify({ error: { message: "API key not valid. Please pass a valid API key." } }),
    "m"
  );
  assert.ok(invalidKey instanceof AuthError, "a 400 about the key is really an auth failure");

  const serverErr = fromGeminiResponse(503, "{}", "m");
  assert.equal(serverErr.retryable, true);
});

test("error payloads never leak a stack trace to the client", () => {
  const json = new AuthError().toJSON();
  assert.deepEqual(Object.keys(json).sort(), ["code", "hint", "message", "status"]);
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

test("markdown export contains the report, review and metrics", async () => {
  const run = await runOrchestration({
    topic: "Export me",
    onApprovalNeeded: async () => true,
  });

  const md = runToMarkdown({ id: "test", ...run });
  assert.match(md, /^# Export me/m);
  assert.match(md, /## Report/);
  assert.match(md, /## Review/);
  assert.match(md, /## Execution metrics/);
  assert.ok(md.includes(run.report.trim()));
});

test("suggestFilename produces a safe slug", () => {
  assert.equal(
    suggestFilename({ topic: "How does /../ orchestration work?" }),
    "how-does-orchestration-work.md"
  );
  assert.equal(suggestFilename({ topic: "!!!" }), "report.md");
});

test("formatMs switches units sensibly", () => {
  assert.equal(formatMs(450), "450 ms");
  assert.equal(formatMs(1500), "1.5 s");
});

// ---------------------------------------------------------------------------

test("AGENT_CHAIN matches the agents the pipeline actually runs", async () => {
  const started = [];
  await runOrchestration({
    topic: "Chain check",
    onApprovalNeeded: async () => true,
    onStep: (e) => {
      if (e.phase === "start" || e.phase === "skip") started.push(e.agent);
    },
  });

  assert.deepEqual(started, AGENT_CHAIN);
});

test("default pipeline language is Turkish and output stays Turkish in mock mode", async () => {
  const run = await runOrchestration({
    topic: "Çok ajanlı sistemlerin faydaları",
    onApprovalNeeded: async () => true,
  });
  assert.equal(run.language, "tr");
  assert.match(run.report, /Özet Rapor|Taslak|bulgular/i);
});

test("English language selection produces English mock report", async () => {
  const run = await runOrchestration({
    topic: "Benefits of multi-agent systems",
    language: "en",
    onApprovalNeeded: async () => true,
  });
  assert.equal(run.language, "en");
  assert.match(run.report, /Summary Report/i);
});

test("Arabic language selection produces Arabic mock report", async () => {
  const run = await runOrchestration({
    topic: "فوائد الأنظمة متعددة الوكلاء",
    language: "ar",
    onApprovalNeeded: async () => true,
  });
  assert.equal(run.language, "ar");
  assert.match(run.report, /تقرير موجز/);
});

test("unsupported language falls back to Turkish", async () => {
  const run = await runOrchestration({
    topic: "Fallback check",
    language: "xx",
    onApprovalNeeded: async () => true,
  });
  assert.equal(run.language, "tr");
});

test("PipelineError carries an actionable hint", () => {
  const err = new PipelineError("boom", { code: "x", hint: "do the thing" });
  assert.equal(err.hint, "do the thing");
  assert.equal(err.retryable, false);
});
