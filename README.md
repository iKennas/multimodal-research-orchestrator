# Multimodal Research Orchestrator

SENG 456 — *Ajan Orkestrasyonu ve Multimodal Sistemler* — individual term project.

A fixed-pipeline multi-agent system. Give it a topic (optionally with an image and
reference text) and five specialised agents cooperate to plan, look, research,
write and review a short report — with a human approval gate before anything gets
rewritten.

Ships with a CLI and a real-time web UI that visualises the pipeline as it runs.

---

## Why this design

The pipeline is a **fixed orchestration**, not an autonomous agent loop. Each agent
has one job and hands its output to the next in a set order. The task
(topic → report) has a predictable shape, so a fixed pipeline is easier to reason
about, cheaper to run and genuinely testable — while still exercising every
concept the course cares about:

| Course concept | Where it lives |
| --- | --- |
| Multi-agent orchestration | `src/orchestrator.js` sequences five agents and passes state between them |
| Tool integration | The research agent calls a deterministic, non-LLM text tool (`src/tools/textTools.js`) and the model interprets its output |
| Multimodal input | The vision agent sends an image + text to Gemini in one multimodal request |
| Conditional branching | The vision step is skipped entirely when no image is supplied |
| Human-in-the-loop authority | A rejected draft is **never** silently rewritten — a human decides |
| Failure handling | Typed errors, automatic retry with backoff, timeouts, cancellation |

## Agents

| Agent | Job | Input | Output |
| --- | --- | --- | --- |
| **Planner** | Breaks the topic into 3–6 steps | topic | numbered plan |
| **Vision** | Describes an image in the topic's context | image + topic | description (or skipped) |
| **Research** | Runs the keyword/phrase/stat tool, then interprets it | topic + optional reference text | keywords, phrases, stats, findings |
| **Writer** | Drafts the report | plan + findings + vision + optional feedback | report |
| **Reviewer** | Checks the draft against the topic | topic + report | `approved` / `needs_revision` + reason |

## The human gate

If the reviewer returns `needs_revision`, the orchestrator pauses and asks a human
whether to accept the draft anyway or send it back. Only a human can authorise a
rewrite. Revisions are capped at **2 rounds** so a picky reviewer can never loop
forever.

## Robustness

Everything below is exercised by the test suite or was hit for real during development:

- **Rate limits (429)** — parses Gemini's own `retryDelay` and waits exactly that long, with exponential backoff + jitter as the fallback.
- **Auth failures (401/403, and the 400 that really means "bad key")** — fails fast with a link to get a key.
- **Retired models (404)** — names the model and points at `GEMINI_MODEL`.
- **Server errors / network blips / timeouts** — retried automatically.
- **Safety-blocked or empty responses** — reported with the finish reason instead of an empty report.
- **Cancellation** — `AbortSignal` threaded through every agent, the HTTP request and the retry backoff; Ctrl+C in the CLI, the cancel button in the UI.
- **Malformed reviewer output** — the verdict is inferred from wording rather than defaulting to "approved", and the UI says it was inferred.
- **Oversized input** — topic, reference text and image size are validated before anything reaches the model.

## Setup

```bash
npm install
cp .env.example .env   # then add your own GEMINI_API_KEY
```

Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

**Without a key the project still runs**, in *offline mock mode*: every agent
returns a deterministic canned response — streamed word by word, so the UI behaves
exactly as it does live. Nothing is sent over the network and no secret is needed.

## Running

### Quick start (Windows)

Double-click one of these — no terminal needed:

| File | What it does |
| --- | --- |
| **`START.bat`** | Normal start. Uses `.env` if present (live), otherwise offline mock. |
| **`START-DEMO-MODE.bat`** | Forces offline mock even when a key is configured — safe for a live presentation: no quota, no rate limits, no network. |

Both check that Node.js is installed and new enough, run `npm install` on first
use, pick a free port automatically (so two copies can run side by side), and open
the browser for you. Close the window to stop the server.

### Web UI (any platform)

```bash
npm run web
```

Then open <http://localhost:4173>. Live pipeline graph, streaming agent output,
per-agent timings and token counts, execution log, run history and Markdown export.

### CLI

```bash
# offline mock mode
node src/cli.js --topic "How does multi-agent orchestration help with multimodal tasks?"

# with a key loaded from .env
npm start -- --topic "Explain agent orchestration"
node --env-file-if-exists=.env src/cli.js --topic "Describe this" --image ./photo.png
node --env-file-if-exists=.env src/cli.js --topic "Summarise this" --reference ./examples/sample-input.txt --md
```

| Flag | Meaning |
| --- | --- |
| `--topic`, `--text` | the question (required) |
| `--image` | attach an image → enables the vision agent |
| `--reference` | reference text file for the research tool |
| `--markdown`, `--md` | print the whole run as Markdown |
| `--quiet`, `-q` | suppress live streaming output |
| `--port` | (server) port to listen on |

## Testing

```bash
npm test
```

26 tests covering the pipeline (event ordering, streaming fidelity, cancellation,
validation, revision bounds), the text tool (including Turkish input and empty
input), the retry layer (backoff, non-retryable errors, abort), Gemini error
classification, and Markdown export. All run offline — no key, no network.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | absent ⇒ offline mock mode |
| `GEMINI_MODEL` | `gemini-2.5-flash` | any model your key can call |
| `REQUEST_TIMEOUT_MS` | `60000` | per-call network budget |
| `LLM_RETRIES` | `3` | retries per agent call |
| `MAX_TOPIC_CHARS` | `2000` | input guardrail |
| `MAX_REFERENCE_CHARS` | `20000` | input guardrail |
| `MAX_IMAGE_BYTES` | `8388608` | 8 MB upload cap |
| `HISTORY_LIMIT` | `25` | runs kept on disk |
| `PORT` | `4173` | web UI port |

> **Note on Gemini 2.5+:** these models spend "thinking" tokens out of the same
> output budget, which silently truncated agent replies mid-sentence. The client
> disables thinking (`thinkingBudget: 0`) for 2.5-and-newer models — these agents
> do short, well-specified tasks and gain nothing from it. Measured effect on one
> run: **36.2s / 3,193 tokens → 3.3s / 683 tokens**, with no truncation.

## Project structure

```
src/
  config.js          env config, mock-mode flag, input limits
  errors.js          typed errors + Gemini response classification
  retry.js           exponential backoff, timeouts, abort-aware sleep
  llmClient.js       streaming Gemini client, usage metrics, offline mock
  tools/textTools.js deterministic keyword/phrase/stat extraction (non-LLM tool)
  agents/            planner · vision · research · writer · reviewer
  orchestrator.js    sequences the agents, metrics, human gate, cancellation
  store.js           run history persisted to runs/
  markdown.js        run → Markdown export
  cli.js             command-line entry point
server.js            Express + SSE API for the web UI
public/              the web UI (no build step, no dependencies)
tests/               node:test suite
```

## API (web UI)

| Endpoint | Purpose |
| --- | --- |
| `GET /api/status` | mode, model, redacted key fingerprint, limits |
| `GET /api/models` | models this key can actually call |
| `POST /api/run` | start a run → `{ jobId }` |
| `GET /api/stream/:jobId` | SSE progress stream (replays from the start, heartbeats) |
| `POST /api/approval/:jobId` | resolve the human gate |
| `POST /api/cancel/:jobId` | abort a run |
| `GET /api/history` | recent runs |
| `GET /api/run/:id` | one full run |
| `GET /api/run/:id/markdown` | download as Markdown |

## Keyboard shortcuts

`⌘/Ctrl + Enter` run · `Esc` cancel run or close drawer · `H` history · `/` focus topic

## Known limitations

- Mock-mode responses are placeholders — they prove the wiring, not answer quality.
- The research "tool" is a local text analyser, not a live web search or external API.
- Vision handles a single still image; no video or audio.
- The free Gemini tier allows only a few requests per minute; a full run makes 4
  calls, so back-to-back runs will trigger the (handled) retry path.

## Security notes

- No key is stored in the repository. `.env` is git-ignored; `.env.example` documents
  variable names only. The UI shows a redacted fingerprint (`…7w`), never the key.
- Uploaded images go to a temp file that is deleted when the run ends; image bytes
  are never written into run history.
- Error payloads sent to the browser carry a code, message and hint — never a stack
  trace or key material.
- The only outbound network destination is the Gemini API, called with the user's
  own key. Run history is written to `runs/` on the local disk only.
