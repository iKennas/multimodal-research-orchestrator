import express from "express";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runOrchestration } from "./src/orchestrator.js";
import { config, keyFingerprint } from "./src/config.js";
import { PipelineError, CancelledError, ValidationError } from "./src/errors.js";
import { listModels } from "./src/llmClient.js";
import { saveRun, listRuns, getRun } from "./src/store.js";
import { runToMarkdown, suggestFilename } from "./src/markdown.js";
import { normalizeLanguage, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from "./src/i18n.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: "24mb" }));
app.use(express.static(path.join(__dirname, "public")));

/**
 * In-flight jobs. Each entry owns the SSE emitter, the abort controller used to
 * cancel the pipeline, and a replay buffer so a client that connects a moment
 * after POST /api/run still sees every event from the beginning.
 *
 * @type {Map<string, {emitter: EventEmitter, controller: AbortController,
 *   pendingApproval: {resolve: (v: boolean) => void}|null, done: boolean, buffer: object[]}>}
 */
const jobs = new Map();

const EXT_BY_MIME = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const JOB_TTL_MS = 10 * 60 * 1000;
const SSE_HEARTBEAT_MS = 15_000;

// ---------------------------------------------------------------------------
// Status & metadata
// ---------------------------------------------------------------------------

app.get("/api/status", (req, res) => {
  res.json({
    mock: config.mock,
    provider: config.provider,
    model: config.mock ? "offline-mock" : config.model,
    keyFingerprint: keyFingerprint(),
    limits: config.limits,
    languages: SUPPORTED_LANGUAGES,
    defaultLanguage: DEFAULT_LANGUAGE,
    activeJobs: [...jobs.values()].filter((j) => !j.done).length,
  });
});

app.get("/api/models", async (req, res) => {
  try {
    res.json({ models: await listModels() });
  } catch (err) {
    res.status(err.status ?? 500).json(errorPayload(err));
  }
});

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

app.get("/api/history", async (req, res) => {
  try {
    res.json({ runs: await listRuns() });
  } catch (err) {
    res.status(500).json(errorPayload(err));
  }
});

app.get("/api/run/:id", async (req, res) => {
  const run = await getRun(req.params.id);
  if (!run) return res.status(404).json({ code: "not_found", message: "No such run." });
  res.json({ run });
});

app.get("/api/run/:id/markdown", async (req, res) => {
  const run = await getRun(req.params.id);
  if (!run) return res.status(404).json({ code: "not_found", message: "No such run." });

  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${suggestFilename(run)}"`);
  res.send(runToMarkdown(run));
});

// ---------------------------------------------------------------------------
// Running the pipeline
// ---------------------------------------------------------------------------

app.post("/api/run", async (req, res) => {
  const { topic, referenceText, imageDataUrl, language } = req.body || {};

  if (!topic || !String(topic).trim()) {
    return res.status(400).json({ code: "validation_error", message: "A topic is required." });
  }

  const jobId = randomUUID();
  const emitter = new EventEmitter();
  // Many SSE clients + heartbeat listeners can attach; the default cap of 10
  // would emit spurious leak warnings.
  emitter.setMaxListeners(50);

  const job = {
    emitter,
    controller: new AbortController(),
    pendingApproval: null,
    done: false,
    buffer: [],
  };
  jobs.set(jobId, job);

  const push = (event) => {
    const stamped = { ...event, at: Date.now() };
    job.buffer.push(stamped);
    emitter.emit("event", stamped);
  };

  // Respond immediately; all progress flows over SSE.
  res.json({ jobId });

  runJob(
    jobId,
    {
      topic: String(topic),
      referenceText,
      imageDataUrl,
      language: normalizeLanguage(language),
    },
    push,
    job
  ).catch((err) => {
    push({ type: "error", error: errorPayload(err) });
  });
});

app.get("/api/stream/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).end();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  // Replay everything that happened before this client attached.
  for (const event of job.buffer) send(event);

  if (job.done) return res.end();

  const onEvent = (event) => {
    send(event);
    if (event.type === "end") res.end();
  };
  job.emitter.on("event", onEvent);

  // Comment frames keep intermediaries from closing an idle stream while a
  // slow model call is still in flight.
  const heartbeat = setInterval(() => res.write(": ping\n\n"), SSE_HEARTBEAT_MS);

  const cleanup = () => {
    clearInterval(heartbeat);
    job.emitter.off("event", onEvent);
  };
  req.on("close", cleanup);
  res.on("finish", cleanup);
});

app.post("/api/approval/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ code: "not_found", message: "No such job." });
  if (!job.pendingApproval) {
    return res.status(409).json({ code: "no_approval_pending", message: "No approval pending." });
  }

  job.pendingApproval.resolve(Boolean(req.body?.accept));
  job.pendingApproval = null;
  res.json({ ok: true });
});

app.post("/api/cancel/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ code: "not_found", message: "No such job." });

  // Unblock a pipeline parked on the human checkpoint before aborting, so the
  // orchestrator can unwind instead of hanging on an unresolved promise.
  job.pendingApproval?.resolve(false);
  job.pendingApproval = null;
  job.controller.abort();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------

async function runJob(jobId, { topic, referenceText, imageDataUrl, language }, push, job) {
  let tmpDir = null;
  let imagePath = null;

  try {
    if (imageDataUrl) {
      ({ tmpDir, imagePath } = await materializeImage(imageDataUrl));
    }

    push({
      type: "job-start",
      jobId,
      topic,
      language,
      mock: config.mock,
      model: config.mock ? "offline-mock" : config.model,
    });

    const result = await runOrchestration({
      topic,
      imagePath,
      referenceText,
      language,
      signal: job.controller.signal,
      onStep: (step) => push({ type: "step", ...step }),
      onApprovalNeeded: () =>
        new Promise((resolve) => {
          job.pendingApproval = { resolve };
        }),
    });

    const run = { id: jobId, ...result };
    await saveRun(run).catch(() => {}); // history is best-effort, never fatal
    push({ type: "result", run });
  } catch (err) {
    if (err instanceof CancelledError) {
      push({ type: "cancelled" });
    } else {
      push({ type: "error", error: errorPayload(err) });
    }
  } finally {
    job.done = true;
    push({ type: "end" });

    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    setTimeout(() => jobs.delete(jobId), JOB_TTL_MS).unref();
  }
}

/** Writes an uploaded data URL to a temp file the vision agent can read. */
async function materializeImage(imageDataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(imageDataUrl);
  if (!match) {
    throw new ValidationError("The uploaded image could not be read.", "Try a different file.");
  }

  const [, mime, base64] = match;
  const ext = EXT_BY_MIME[mime];
  if (!ext) {
    throw new ValidationError(
      `Unsupported image type "${mime}".`,
      `Supported formats: ${Object.keys(EXT_BY_MIME).join(", ")}`
    );
  }

  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > config.limits.imageBytes) {
    throw new ValidationError(
      `Image is too large (${(buffer.length / 1024 / 1024).toFixed(1)} MB).`,
      `The limit is ${(config.limits.imageBytes / 1024 / 1024).toFixed(1)} MB.`
    );
  }

  const tmpDir = await mkdtemp(path.join(tmpdir(), "mro-"));
  const imagePath = path.join(tmpDir, `upload${ext}`);
  await writeFile(imagePath, buffer);
  return { tmpDir, imagePath };
}

/** Never leaks stack traces or the API key to the browser. */
function errorPayload(err) {
  if (err instanceof PipelineError) return err.toJSON();
  return { code: "unknown_error", message: err?.message || "Something went wrong." };
}

// Port precedence: --port flag > PORT env var > default.
const portFlagIndex = process.argv.indexOf("--port");
const port =
  (portFlagIndex !== -1 && Number.parseInt(process.argv[portFlagIndex + 1], 10)) ||
  Number.parseInt(process.env.PORT, 10) ||
  4173;
const server = app.listen(port, () => {
  console.log(`\n  Multimodal Research Orchestrator`);
  console.log(`  → http://localhost:${port}\n`);
  console.log(
    config.mock
      ? "  Mode: offline mock (no API key set)\n"
      : `  Mode: live · ${config.provider} · ${config.model} · key ${keyFingerprint()}\n`
  );
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  Port ${port} is already in use.`);
    console.error("  Either close the other server, or start this one on a free port:");
    console.error(`      node server.js --port ${port + 1}\n`);
  } else {
    console.error(`\n  Could not start the server: ${err.message}\n`);
  }
  process.exit(1);
});

// Ctrl+C / window close should release the port immediately rather than
// leaving a half-open listener behind.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log("\n  Shutting down…\n");
    server.close(() => process.exit(0));
    // Open SSE streams would otherwise keep the process alive indefinitely.
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
