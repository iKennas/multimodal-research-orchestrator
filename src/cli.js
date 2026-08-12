import { readFile } from "node:fs/promises";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { runOrchestration } from "./orchestrator.js";
import { config, keyFingerprint } from "./config.js";
import { PipelineError, CancelledError } from "./errors.js";
import { runToMarkdown, formatMs } from "./markdown.js";

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};

const AGENT_LABEL = {
  planner: "Planner",
  vision: "Vision",
  research: "Research",
  writer: "Writer",
  reviewer: "Reviewer",
  human: "Human",
};

function parseArgs(argv) {
  const args = { topic: null, image: null, reference: null, language: "tr", markdown: false, quiet: false };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--topic" || flag === "--text") args.topic = argv[++i];
    else if (flag === "--image") args.image = argv[++i];
    else if (flag === "--reference") args.reference = argv[++i];
    else if (flag === "--language" || flag === "--lang") args.language = argv[++i];
    else if (flag === "--markdown" || flag === "--md") args.markdown = true;
    else if (flag === "--quiet" || flag === "-q") args.quiet = true;
    else if (flag === "--help" || flag === "-h") args.help = true;
  }
  return args;
}

const USAGE = `
${c.bold("Multimodal Research Orchestrator")}

  node src/cli.js --topic "your question" [options]

${c.bold("Options")}
  --topic, --text <text>   the question to research (required)
  --image <path>           attach an image for the vision agent
  --reference <path>       reference text file for the research agent
  --language, --lang <code>  output language: tr (default), en, or ar
  --markdown, --md         print the full run as Markdown instead of a summary
  --quiet, -q              suppress live streaming output
  --help, -h               show this message

${c.bold("Environment")}
  GEMINI_API_KEY           enables live mode; without it the run is fully offline
  GEMINI_MODEL             defaults to gemini-2.5-flash

  Load a .env file with:  node --env-file-if-exists=.env src/cli.js ...
`;

async function askForApproval(review) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  console.log(`\n${c.amber("⚠ Reviewer requested a revision:")} ${review.reason}`);
  const answer = await rl.question(c.dim("  Accept the draft as-is anyway? (y/N) "));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.topic) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 1);
  }

  console.log(
    config.mock
      ? c.dim("○ offline mock mode — no GEMINI_API_KEY set\n")
      : c.dim(`● live · ${config.model} · key ${keyFingerprint()}\n`)
  );

  const referenceText = args.reference ? await readFile(args.reference, "utf8") : "";

  // Ctrl+C cancels the pipeline cleanly instead of killing the process mid-call.
  const controller = new AbortController();
  process.on("SIGINT", () => {
    console.log(c.dim("\n\n  cancelling…"));
    controller.abort();
  });

  let streamingAgent = null;
  const onStep = ({ agent, phase, data }) => {
    const label = AGENT_LABEL[agent] ?? agent;

    if (phase === "start") {
      const suffix = data?.revision ? c.dim(" (revision)") : "";
      process.stdout.write(`${c.cyan("▸")} ${c.bold(label)}${suffix}\n`);
    } else if (phase === "delta" && !args.quiet) {
      if (data.restart) {
        streamingAgent = agent;
        return;
      }
      if (streamingAgent === agent) process.stdout.write(c.dim(data.delta));
    } else if (phase === "skip") {
      process.stdout.write(`${c.dim("▹")} ${c.dim(`${label} skipped — ${data.reason}`)}\n`);
    } else if (phase === "retry") {
      process.stdout.write(
        `\n${c.amber("  ↻")} ${c.dim(
          `${label} retry ${data.attempt} in ${Math.round(data.delayMs / 1000)}s — ${data.message}`
        )}\n`
      );
    } else if (phase === "end") {
      if (!args.quiet && streamingAgent === agent) process.stdout.write("\n");
      streamingAgent = null;
      process.stdout.write(
        `${c.green("✓")} ${c.dim(`${label} — ${formatMs(data.durationMs)}, ${data.usage.totalTokens} tokens`)}\n\n`
      );
    } else if (phase === "error") {
      process.stdout.write(`\n${c.red("✗")} ${label} — ${data.message}\n`);
    }
  };

  const run = await runOrchestration({
    topic: args.topic,
    imagePath: args.image,
    referenceText,
    language: args.language,
    signal: controller.signal,
    onStep,
    onApprovalNeeded: askForApproval,
  });

  if (args.markdown) {
    console.log(runToMarkdown({ id: "cli", ...run }));
    return;
  }

  console.log(c.bold("\n─── Final report ───\n"));
  console.log(run.report);

  console.log(c.bold("\n─── Review ───\n"));
  const statusText =
    run.review.status === "approved" ? c.green("approved") : c.amber("needs revision");
  console.log(`Status: ${statusText}${run.revised ? c.dim(` (after ${run.revisions} revision(s))`) : ""}`);
  if (run.review.reason) console.log(c.dim(`Reason: ${run.review.reason}`));
  if (run.hitRevisionLimit) console.log(c.amber("Stopped at the revision limit."));

  const { metrics } = run;
  console.log(
    c.dim(
      `\n${formatMs(metrics.totalDurationMs)} · ${metrics.usage.totalTokens} tokens ` +
        `(${metrics.usage.promptTokens} in / ${metrics.usage.outputTokens} out)` +
        (metrics.retries ? ` · ${metrics.retries} retries` : "")
    )
  );
}

main().catch((err) => {
  if (err instanceof CancelledError) {
    console.log(c.dim("  cancelled.\n"));
    process.exit(130);
  }

  console.error(`\n${c.red("✗ " + (err.message || "Something went wrong."))}`);
  if (err instanceof PipelineError && err.hint) {
    console.error(c.dim(`  ${err.hint}`));
  }
  console.error("");
  process.exit(1);
});
