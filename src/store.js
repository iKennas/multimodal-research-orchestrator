import { mkdir, readdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = path.join(__dirname, "..", "runs");

/**
 * Finished runs are written to disk as one JSON file each so the history panel
 * survives a server restart. Only pipeline output is stored - never the API key
 * and never the uploaded image bytes.
 */

async function ensureDir() {
  await mkdir(RUNS_DIR, { recursive: true });
}

export async function saveRun(run) {
  await ensureDir();
  const file = path.join(RUNS_DIR, `${run.id}.json`);
  await writeFile(file, JSON.stringify(run, null, 2), "utf8");
  await pruneOldRuns();
  return run.id;
}

export async function getRun(id) {
  // Defend against path traversal - ids are generated as UUIDs, so anything
  // else is either a bug or an attempt to read outside the runs directory.
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  try {
    const raw = await readFile(path.join(RUNS_DIR, `${id}.json`), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Newest first, trimmed to the fields the history list actually renders. */
export async function listRuns(limit = config.historyLimit) {
  await ensureDir();
  const runs = await readAllRuns();

  return runs
    .sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt))
    .slice(0, limit)
    .map((run) => ({
      id: run.id,
      topic: run.topic,
      language: run.language ?? null,
      status: run.review?.status ?? "unknown",
      revised: Boolean(run.revised),
      mock: Boolean(run.mock),
      model: run.model,
      durationMs: run.metrics?.totalDurationMs ?? 0,
      totalTokens: run.metrics?.usage?.totalTokens ?? 0,
      finishedAt: run.finishedAt,
    }));
}

/** Keeps the runs directory bounded; oldest files are dropped first. */
async function pruneOldRuns() {
  const runs = await readAllRuns();
  if (runs.length <= config.historyLimit) return;

  const stale = runs
    .sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt))
    .slice(config.historyLimit);

  await Promise.all(
    stale.map((run) => unlink(path.join(RUNS_DIR, `${run.id}.json`)).catch(() => {}))
  );
}

async function readAllRuns() {
  await ensureDir();
  const files = (await readdir(RUNS_DIR)).filter((f) => f.endsWith(".json"));

  const runs = await Promise.all(
    files.map(async (file) => {
      try {
        return JSON.parse(await readFile(path.join(RUNS_DIR, file), "utf8"));
      } catch {
        return null; // skip a truncated/corrupt file rather than failing the list
      }
    })
  );

  return runs.filter(Boolean);
}
