/* ===========================================================================
   Multimodal Research Orchestrator — client
   Drives the pipeline visualisation from the server's SSE event stream.
   ======================================================================== */

const I18N = window.MRO_I18N;
const t = (key, vars) => I18N.t(key, vars);

const CHAIN = ["planner", "vision", "research", "writer", "reviewer"];
const EDGES = [
  ["planner", "vision"],
  ["vision", "research"],
  ["research", "writer"],
  ["writer", "reviewer"],
  ["reviewer", "human"],
];

function agentLabel(agent) {
  const map = {
    planner: "agentPlanner",
    vision: "agentVision",
    research: "agentResearch",
    writer: "agentWriter",
    reviewer: "agentReviewer",
    human: "agentHuman",
  };
  return t(map[agent] || agent);
}

/** Which output tab each agent streams into. */
const AGENT_PANEL = {
  planner: "plan", vision: "vision", research: "research",
  writer: "report", reviewer: "review",
};

const $ = (id) => document.getElementById(id);

const el = {
  canvas: $("canvas"), edges: $("edges"), consoleBody: $("consoleBody"),
  modePill: $("modePill"), modeLabel: $("modeLabel"), liveDot: $("liveDot"),
  runForm: $("runForm"), runBtn: $("runBtn"), runBtnLabel: $("runBtnLabel"), cancelBtn: $("cancelBtn"),
  topic: $("topic"), topicCount: $("topicCount"), reference: $("reference"),
  languageSelect: $("languageSelect"),
  dropzone: $("dropzone"), imageInput: $("imageInput"), dzEmpty: $("dropzoneEmpty"),
  dzPreviewWrap: $("dropzonePreviewWrap"), dzPreview: $("dropzonePreview"),
  dzName: $("dropzoneName"), dzSize: $("dropzoneSize"), removeImage: $("removeImage"),
  tabs: $("tabs"), tabUnderline: $("tabUnderline"), tabPanels: $("tabPanels"),
  ringFill: $("ringFill"), ringText: $("ringText"), progressRing: $("progressRing"),
  hudTime: $("hudTime"), hudTokens: $("hudTokens"), hudRetries: $("hudRetries"),
  modal: $("approvalModal"), modalReason: $("modalReason"),
  btnAccept: $("btnAccept"), btnRevise: $("btnRevise"),
  drawer: $("historyDrawer"), drawerScrim: $("drawerScrim"), historyList: $("historyList"),
  historyBtn: $("historyBtn"), closeDrawer: $("closeDrawer"),
  clearLog: $("clearLog"), copyLog: $("copyLog"),
  copyOutput: $("copyOutput"), exportBtn: $("exportBtn"),
  toasts: $("toasts"),
  workspaceModes: document.querySelector(".workspace-modes"),
  chatPanel: $("chatPanel"), chatThread: $("chatThread"), chatEmpty: $("chatEmpty"),
  chatInput: $("chatInput"), chatSendBtn: $("chatSendBtn"), chatAttachBtn: $("chatAttachBtn"),
  clearChat: $("clearChat"), outputPanel: $("outputPanel"),
};

const nodeEl = {};
document.querySelectorAll(".node").forEach((n) => (nodeEl[n.dataset.agent] = n));

const state = {
  jobId: null,
  source: null,
  running: false,
  pendingApproval: false,
  workspace: "research", // research | chat
  chatTurns: [],
  imageDataUrl: null,
  startedAt: 0,
  tokens: 0,
  retries: 0,
  completed: 0,          // agents finished, drives the progress ring
  expected: CHAIN.length,
  streamBuf: {},         // agent -> text accumulated from deltas
  agentTimers: {},       // agent -> interval id for the live duration counter
  tickTimer: null,
  userPinnedTab: false,  // stop auto-switching once the user picks a tab
  lastRunId: null,
};

// ───────────────────────── boot ─────────────────────────
// Defined here, invoked at the very end of the file: the module-scoped `const`
// bindings further down must be initialised before any of this touches them.

function init() {
  I18N.init();
  if (el.languageSelect) el.languageSelect.value = I18N.get();

  resetPipeline();
  setWorkspace(localStorage.getItem("mro-workspace") === "chat" ? "chat" : "research", { silent: true });

  // The nodes animate in (translate + scale), so their geometry is not final on
  // the first frame. A ResizeObserver fires once on attach and again whenever
  // the canvas settles, which covers boot, entrance animation and window resize
  // without guessing at timings.
  const relayout = debounce(() => { layoutEdges(); moveUnderline(); }, 60);
  new ResizeObserver(relayout).observe(el.canvas);
  nodeEl.planner && new ResizeObserver(relayout).observe(nodeEl.planner);

  window.addEventListener("resize", relayout);
  el.canvas.closest(".canvas-scroll").addEventListener("scroll", () => layoutEdges());
  // Late webfont/layout shifts can move things again after everything "looks" done.
  window.addEventListener("load", relayout);
  window.addEventListener("mro:langchange", () => {
    // RTL flips edge endpoints; empty panel hints need a refresh if still empty.
    layoutEdges();
    moveUnderline();
    refreshEmptyHints();
    refreshIdleConsole();
    if (!state.running) {
      el.runBtnLabel.textContent = t("runPipeline");
    }
  });

  updateCharCount();
  fetchStatus();
  loadHistory();
}

function refreshEmptyHints() {
  const empties = {
    report: "emptyReport",
    plan: "emptyPlan",
    research: "emptyResearch",
    vision: "emptyVision",
    review: "emptyReview",
  };
  for (const [name, key] of Object.entries(empties)) {
    const p = panel(name)?.querySelector(".empty-hint");
    if (p && panel(name).childElementCount === 1) p.textContent = t(key);
  }
}

/** Keep the idle console line in sync when the language changes before a run. */
function refreshIdleConsole() {
  if (state.running) return;
  const body = el.consoleBody;
  if (!body) return;
  const lines = [...body.querySelectorAll(".console-line")];
  const onlyIdle =
    lines.length === 0 ||
    (lines.length === 1 && lines[0].classList.contains("muted"));
  if (!onlyIdle) return;
  body.replaceChildren();
  const line = document.createElement("div");
  line.className = "console-line muted";
  const ts = document.createElement("span");
  ts.className = "ts";
  ts.textContent = "—";
  const msg = document.createElement("span");
  msg.textContent = t("consoleIdle");
  line.append(ts, msg);
  body.appendChild(line);
}

async function fetchStatus() {
  try {
    const data = await fetchJSON("/api/status");
    el.modePill.classList.remove("live", "mock", "error");
    if (data.mock) {
      el.modePill.classList.add("mock");
      el.modeLabel.textContent = t("offlineMock");
      el.modePill.title = t("mockTitle");
    } else {
      el.modePill.classList.add("live");
      el.modeLabel.textContent = data.model;
      el.modePill.title = t("liveTitle", { key: data.keyFingerprint ?? "" });
    }
  } catch {
    el.modePill.classList.add("error");
    el.modeLabel.textContent = t("serverOffline");
  }
}

// ───────────────────────── edges ─────────────────────────
// Paths are built once per layout; state changes only toggle classes and
// add/remove the travelling packet, so a run never triggers a full rebuild.

const edgePaths = new Map();

function isVerticalPipeline() {
  return getComputedStyle(el.canvas).flexDirection.startsWith("column");
}

function layoutEdges() {
  const box = el.canvas.getBoundingClientRect();
  const vertical = isVerticalPipeline();
  const svgW = Math.max(el.canvas.scrollWidth, box.width);
  const svgH = Math.max(el.canvas.scrollHeight, box.height);

  el.edges.setAttribute("viewBox", `0 0 ${svgW} ${svgH}`);
  el.edges.setAttribute("width", svgW);
  el.edges.setAttribute("height", svgH);

  const defs = el.edges.querySelector("defs");
  el.edges.replaceChildren(defs);
  edgePaths.clear();

  // Flow gradient follows the pipeline axis (horizontal on desktop, vertical on phone).
  const grad = defs.querySelector("#edgeFlow");
  if (grad) {
    grad.setAttribute("x1", "0");
    grad.setAttribute("y1", "0");
    grad.setAttribute("x2", vertical ? "0" : "1");
    grad.setAttribute("y2", vertical ? "1" : "0");
  }

  const rtl = document.documentElement.dir === "rtl";

  for (const [a, b] of EDGES) {
    const ra = nodeEl[a].getBoundingClientRect();
    const rb = nodeEl[b].getBoundingClientRect();

    let d;
    if (vertical) {
      const x1 = ra.left + ra.width / 2 - box.left;
      const y1 = ra.bottom - box.top;
      const x2 = rb.left + rb.width / 2 - box.left;
      const y2 = rb.top - box.top;
      const my = (y1 + y2) / 2;
      d = `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
    } else {
      // In RTL the pipeline still flows planner→… visually left-to-right in the
      // flex row, but edge anchors should use the facing sides of each node.
      const x1 = (rtl ? ra.left : ra.right) - box.left;
      const y1 = ra.top + ra.height / 2 - box.top;
      const x2 = (rtl ? rb.right : rb.left) - box.left;
      const y2 = rb.top + rb.height / 2 - box.top;
      const mx = (x1 + x2) / 2;
      d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
    }

    const path = svg("path", { d, class: "edge-path" });
    if (b === "human") path.classList.add("pending-human");

    el.edges.appendChild(path);
    edgePaths.set(key(a, b), { path, d });
  }

  // Re-apply any state the run had already reached before this relayout.
  for (const [k, s] of Object.entries(edgeState)) setEdge(k, s, true);
}

let edgeState = {};

function setEdge(k, status, silent = false) {
  if (!silent) edgeState[k] = status;
  const entry = edgePaths.get(k);
  if (!entry) return;

  entry.path.classList.remove("flowing", "done");
  if (status) entry.path.classList.add(status);

  el.edges.querySelector(`[data-packet="${k}"]`)?.remove();
  if (status === "flowing") el.edges.appendChild(makePacket(k, entry.d));
}

function makePacket(k, d) {
  const g = svg("g", { "data-packet": k, class: "edge-packet" });
  const dot = svg("circle", { r: 3.2, fill: "#22d3ee" });
  const motion = svg("animateMotion", { dur: "1.15s", repeatCount: "indefinite", path: d, rotate: "auto" });
  dot.appendChild(motion);

  const trail = svg("circle", { r: 5.5, fill: "#22d3ee", opacity: 0.28 });
  const motion2 = svg("animateMotion", { dur: "1.15s", repeatCount: "indefinite", path: d, begin: "-0.09s" });
  trail.appendChild(motion2);

  g.append(trail, dot);
  return g;
}

const key = (a, b) => `${a}->${b}`;
function svg(tag, attrs) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// ───────────────────────── node state ─────────────────────────

function setNode(agent, status, text) {
  const node = nodeEl[agent];
  if (!node) return;
  node.classList.remove("running", "done", "skipped", "waiting", "error", "retrying");
  if (status) node.classList.add(status);
  node.querySelector(".state-text").textContent =
    text ?? status ?? (agent === "human" ? t("standby") : t("idle"));
}

function setNodeMetric(agent, metric, value) {
  nodeEl[agent]?.querySelector(`[data-metric="${metric}"]`)?.replaceChildren(document.createTextNode(value));
}

/** Ticks a node's duration readout while its agent is in flight. */
function startNodeTimer(agent) {
  stopNodeTimer(agent);
  const t0 = Date.now();
  state.agentTimers[agent] = setInterval(() => {
    setNodeMetric(agent, "time", fmtMs(Date.now() - t0));
  }, 100);
}
function stopNodeTimer(agent) {
  clearInterval(state.agentTimers[agent]);
  delete state.agentTimers[agent];
}

function resetPipeline() {
  edgeState = {};
  for (const a of [...CHAIN, "human"]) {
    stopNodeTimer(a);
    setNode(a, null, a === "human" ? t("standby") : t("idle"));
    setNodeMetric(a, "time", "—");
    setNodeMetric(a, "tokens", "");
  }
  for (const [a, b] of EDGES) setEdge(key(a, b), null);

  state.streamBuf = {};
  state.completed = 0;
  state.tokens = 0;
  state.retries = 0;
  state.pendingApproval = false;
  setProgress(0);
  el.hudTokens.textContent = "0";
  el.hudRetries.textContent = "0";
  el.hudTime.textContent = "0.0s";
  el.progressRing.classList.remove("complete");
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("has-content"));
}

// ───────────────────────── progress + HUD ─────────────────────────

const RING_CIRCUMFERENCE = 113.1;

function setProgress(fraction) {
  const clamped = Math.max(0, Math.min(1, fraction));
  el.ringFill.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - clamped));
  el.ringText.innerHTML = `${Math.round(clamped * 100)}<i>%</i>`;
  if (clamped >= 1) el.progressRing.classList.add("complete");
}

function bumpHud(node, value) {
  node.textContent = value;
  node.classList.remove("bump");
  void node.offsetWidth; // restart the animation
  node.classList.add("bump");
}

function startClock() {
  state.startedAt = Date.now();
  clearInterval(state.tickTimer);
  state.tickTimer = setInterval(() => {
    el.hudTime.textContent = fmtMs(Date.now() - state.startedAt);
  }, 100);
}
function stopClock() { clearInterval(state.tickTimer); }

// ───────────────────────── console ─────────────────────────

function log(message, cls = "info") {
  const line = document.createElement("div");
  line.className = `console-line ${cls}`;

  const ts = document.createElement("span");
  ts.className = "ts";
  ts.textContent = new Date().toLocaleTimeString([], { hour12: false });

  const msg = document.createElement("span");
  msg.className = "msg";
  msg.textContent = message;

  line.append(ts, msg);
  el.consoleBody.appendChild(line);
  el.consoleBody.scrollTop = el.consoleBody.scrollHeight;

  // Keep the log bounded so very long sessions don't grow without limit.
  while (el.consoleBody.childElementCount > 400) el.consoleBody.firstElementChild.remove();
}

// ───────────────────────── workspace modes ─────────────────────────

function setWorkspace(mode, { silent = false } = {}) {
  const next = mode === "chat" ? "chat" : "research";
  state.workspace = next;
  document.body.dataset.workspace = next;
  localStorage.setItem("mro-workspace", next);

  el.workspaceModes?.setAttribute("data-active", next);
  el.workspaceModes?.querySelectorAll(".workspace-mode").forEach((btn) => {
    const active = btn.dataset.workspace === next;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });

  if (el.topic) el.topic.required = next === "research";

  const title = el.runForm?.querySelector(".panel-title");
  if (title) title.textContent = next === "chat" ? t("chatTitle") : t("newRun");

  if (!silent) {
    log(next === "chat" ? t("switchedToChat") : t("switchedToResearch"), "info");
    requestAnimationFrame(() => {
      layoutEdges();
      moveUnderline();
    });
  }
}

el.workspaceModes?.addEventListener("click", (e) => {
  const btn = e.target.closest(".workspace-mode");
  if (!btn || state.running) return;
  setWorkspace(btn.dataset.workspace);
});

function appendChatMessage(role, content, { html = false, meta = "" } = {}) {
  if (el.chatEmpty) el.chatEmpty.classList.add("hidden");

  const wrap = document.createElement("div");
  wrap.className = `chat-msg ${role}`;

  if (meta) {
    const m = document.createElement("div");
    m.className = "chat-meta";
    m.textContent = meta;
    wrap.append(m);
  }

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  if (html) bubble.innerHTML = content;
  else bubble.textContent = content;
  wrap.append(bubble);

  el.chatThread.appendChild(wrap);
  el.chatThread.scrollTop = el.chatThread.scrollHeight;
  return wrap;
}

function appendChatTyping() {
  const wrap = document.createElement("div");
  wrap.className = "chat-msg assistant";
  wrap.dataset.typing = "1";
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.innerHTML = `<span class="chat-typing" aria-label="…"><i></i><i></i><i></i></span>`;
  wrap.append(bubble);
  el.chatThread.appendChild(wrap);
  el.chatThread.scrollTop = el.chatThread.scrollHeight;
  return wrap;
}

function buildChatReference() {
  if (!state.chatTurns.length) return "";
  return state.chatTurns
    .slice(-4)
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`)
    .join("\n\n");
}

async function startPipeline({ topic, referenceText, fromChat = false }) {
  if (state.running) return;
  const language = I18N.normalize(el.languageSelect?.value || I18N.get());

  setRunning(true);
  resetPipeline();
  el.consoleBody.replaceChildren();
  state.userPinnedTab = false;
  state.expected = CHAIN.length - (state.imageDataUrl ? 0 : 1);
  state.fromChat = fromChat;
  startClock();

  log(t("runStarted", { topic: truncate(topic, 90) }), "info");
  if (state.imageDataUrl) log(t("imageAttached"), "info");
  if (referenceText?.trim()) log(t("referenceAttached"), "info");

  try {
    const { jobId } = await fetchJSON("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        referenceText: referenceText || "",
        imageDataUrl: state.imageDataUrl,
        language,
      }),
    });
    state.jobId = jobId;
    openStream(jobId);
  } catch (err) {
    log(`${t("couldNotStart")}: ${err.message}`, "err");
    toast("err", t("couldNotStart"), err.message);
    setRunning(false);
    stopClock();
    if (fromChat) {
      el.chatThread.querySelector('[data-typing="1"]')?.remove();
      appendChatMessage("assistant", t("couldNotStart") + ": " + err.message, { meta: t("error") });
    }
  }
}

// ───────────────────────── run lifecycle ─────────────────────────

el.runForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.workspace !== "research") return;
  if (state.running) return;

  const topic = el.topic.value.trim();
  if (!topic) { toast("warn", t("enterTopic")); el.topic.focus(); return; }

  await startPipeline({
    topic,
    referenceText: el.reference.value,
    fromChat: false,
  });
});

el.chatSendBtn?.addEventListener("click", () => sendChat());
el.chatInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});
el.chatAttachBtn?.addEventListener("click", () => el.imageInput?.click());
el.clearChat?.addEventListener("click", () => {
  state.chatTurns = [];
  el.chatThread.replaceChildren();
  if (el.chatEmpty) {
    el.chatThread.appendChild(el.chatEmpty);
    el.chatEmpty.classList.remove("hidden");
  }
});

async function sendChat() {
  if (state.running) return;
  const topic = el.chatInput.value.trim();
  if (!topic) { toast("warn", t("enterTopic")); el.chatInput.focus(); return; }

  appendChatMessage("user", topic);
  state.chatTurns.push({ role: "user", text: topic });
  el.chatInput.value = "";
  appendChatTyping();

  await startPipeline({
    topic,
    referenceText: buildChatReference(),
    fromChat: true,
  });
}

function openStream(jobId) {
  state.source?.close();
  const source = new EventSource(`/api/stream/${jobId}`);
  state.source = source;

  source.onmessage = (e) => {
    try { handleEvent(JSON.parse(e.data)); }
    catch { /* ignore a malformed frame rather than killing the stream */ }
  };
  source.onerror = () => {
    // While parked on the human gate the EventSource can flap without the job
    // dying — don't wipe the UI / hide the modal on the first blip.
    if (!state.running) return;
    if (state.pendingApproval) {
      log(t("connectionLost"), "warn");
      return;
    }
    source.close();
    log(t("connectionLost"), "err");
    toast("err", t("connectionLost"));
    finishRun();
  };
}

function handleEvent(event) {
  switch (event.type) {
    case "job-start":
      log(t("pipelineOnline", { mode: event.mock ? t("offlineMock") : event.model }), "info");
      el.liveDot.classList.add("active");
      break;

    case "step":
      handleStep(event);
      break;

    case "result":
      handleResult(event.run);
      break;

    case "cancelled":
      log(t("runCancelled"), "warn");
      toast("warn", t("runCancelled"));
      // An agent parked in a retry backoff is mid-flight too, not just `.running`.
      for (const a of CHAIN) {
        if (nodeEl[a].classList.contains("running") || nodeEl[a].classList.contains("retrying")) {
          stopNodeTimer(a);
          setNode(a, null, t("cancelled"));
        }
      }
      if (nodeEl.human.classList.contains("waiting")) setNode("human", null, t("standby"));
      break;

    case "error":
      handleError(event.error);
      break;

    case "end":
      finishRun();
      break;
  }
}

function handleStep({ agent, phase, data }) {
  const label = agentLabel(agent);

  switch (phase) {
    case "start": {
      setNode(agent, "running", data?.revision ? t("revising") : t("runningState"));
      startNodeTimer(agent);
      const idx = CHAIN.indexOf(agent);
      if (idx > 0) setEdge(key(CHAIN[idx - 1], agent), "flowing");
      log(`${label} ${t("started")}${data?.revision ? t("revisionPass") : ""}`, "agent");
      focusPanelFor(agent);
      break;
    }

    case "delta":
      if (data.restart) state.streamBuf[agent] = "";
      else state.streamBuf[agent] = (state.streamBuf[agent] ?? "") + data.delta;
      renderStreaming(agent, state.streamBuf[agent]);
      break;

    case "retry":
      state.retries++;
      bumpHud(el.hudRetries, String(state.retries));
      setNode(agent, "retrying", `${t("retrying")} ${data.attempt}`);
      log(`${label} — ${data.message} ${t("retryingIn", { s: Math.round(data.delayMs / 1000) })}`, "warn");
      toast("warn", `${label}: ${t("retrying")}`, data.message);
      break;

    case "skip":
      setNode(agent, "skipped", t("skipped"));
      setNodeMetric(agent, "time", "—");
      setEdge(key("planner", "vision"), "done");
      setEdge(key("vision", "research"), "done");
      log(`${label} ${t("skippedReason", { reason: data.reason })}`, "info");
      break;

    case "end": {
      stopNodeTimer(agent);
      setNode(agent, "done", t("done"));
      setNodeMetric(agent, "time", fmtMs(data.durationMs));
      setNodeMetric(agent, "tokens", `${data.usage.totalTokens} tok`);

      state.tokens += data.usage.totalTokens ?? 0;
      bumpHud(el.hudTokens, state.tokens.toLocaleString());

      const idx = CHAIN.indexOf(agent);
      if (idx > 0) setEdge(key(CHAIN[idx - 1], agent), "done");

      state.completed = Math.min(state.completed + 1, state.expected);
      setProgress(state.completed / state.expected);

      renderFinal(agent, data.result);
      log(`${label} ${t("done")} · ${fmtMs(data.durationMs)} · ${data.usage.totalTokens} tokens`, "ok");
      break;
    }

    case "error":
      stopNodeTimer(agent);
      setNode(agent, "error", t("failed"));
      log(`${label} ${t("failed")} — ${data.message}`, "err");
      break;

    case "approval-needed":
      state.pendingApproval = true;
      setEdge(key("reviewer", "human"), "flowing");
      setNode("human", "waiting", t("awaitingYou"));
      log(t("reviewerRequested", { reason: data.reason }), "warn");
      // Keep the draft visible behind the modal so the run never looks empty.
      if (!state.userPinnedTab) activateTab("report");
      openModal(data.reason);
      break;

    case "approval-resolved":
      state.pendingApproval = false;
      setEdge(key("reviewer", "human"), "done");
      setNode("human", "done", data.acceptAsIs ? t("accepted") : t("sentBack"));
      log(data.acceptAsIs ? t("youAccepted") : t("youSentBack"), "ok");
      // A revision replays writer + reviewer, so widen the progress denominator.
      if (!data.acceptAsIs) { state.expected += 2; setProgress(state.completed / state.expected); }
      break;
  }
}

function handleResult(run) {
  state.lastRunId = run.id;
  state.pendingApproval = false;
  el.exportBtn.disabled = false;

  // Always re-pin final artifacts — earlier tab focus may have left Report looking empty.
  if (run.plan?.length) renderFinal("planner", { steps: run.plan });
  if (run.research) renderFinal("research", run.research);
  if (run.report) renderFinal("writer", { report: run.report });
  if (run.review) renderFinal("reviewer", run.review);
  if (run.vision) renderFinal("vision", { description: run.vision });
  else panel("vision").replaceChildren(hint(t("noImageRun")));

  state.userPinnedTab = false;
  activateTab("report");
  setProgress(1);
  expandResearchOutput();

  if (state.fromChat || state.workspace === "chat") {
    el.chatThread.querySelector('[data-typing="1"]')?.remove();
    const verdict = run.review?.status === "approved" ? t("approved") : t("needsRevision");
    const html = formatProseHtml(run.report || "");
    appendChatMessage("assistant", html, {
      html: true,
      meta: `${verdict} · ${fmtMs(run.metrics.totalDurationMs)} · ${run.metrics.usage.totalTokens} tok`,
    });
    state.chatTurns.push({ role: "assistant", text: run.report || "" });
  }

  const verdict = run.review.status === "approved" ? t("approved") : t("needsRevision");
  log(
    t("pipelineComplete", {
      verdict,
      time: fmtMs(run.metrics.totalDurationMs),
      tokens: run.metrics.usage.totalTokens,
    }),
    run.review.status === "approved" ? "ok" : "warn"
  );

  toast(
    run.review.status === "approved" ? "ok" : "warn",
    run.review.status === "approved" ? t("reportApproved") : t("reportNeedsRevision"),
    `${fmtMs(run.metrics.totalDurationMs)} · ${run.metrics.usage.totalTokens} tokens` +
      (run.revisions ? t("revisionCount", { n: run.revisions }) : "")
  );

  loadHistory();
}

/** Grow the report panel and scroll it into view so Research results are readable. */
function expandResearchOutput() {
  if (state.workspace !== "research") return;
  el.outputPanel?.classList.add("has-results");
  el.runForm?.classList.add("compact");
  requestAnimationFrame(() => {
    el.outputPanel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const stack = el.outputPanel?.closest(".sidebar-stack");
    if (stack && el.outputPanel) {
      const top = el.outputPanel.offsetTop - 8;
      stack.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }
    moveUnderline();
  });
}

function handleError(error) {
  log(`${error.message}${error.hint ? ` — ${error.hint}` : ""}`, "err");
  toast("err", error.message, error.hint);
  for (const a of CHAIN) {
    if (nodeEl[a].classList.contains("running") || nodeEl[a].classList.contains("retrying")) {
      stopNodeTimer(a);
      setNode(a, "error", t("failed"));
    }
  }
}

function finishRun() {
  setRunning(false);
  stopClock();
  el.liveDot.classList.remove("active");
  for (const a of [...CHAIN, "human"]) stopNodeTimer(a);
  for (const [a, b] of EDGES) if (edgeState[key(a, b)] === "flowing") setEdge(key(a, b), "done");
  state.source?.close();
  state.source = null;
  el.modal.classList.add("hidden");
  document.querySelectorAll(".report-text.streaming").forEach((n) => n.classList.remove("streaming"));
  // If a chat turn was cancelled / errored mid-flight, drop the typing bubble.
  if (!state.pendingApproval) {
    el.chatThread?.querySelector('[data-typing="1"]')?.remove();
  }
}

function setRunning(running) {
  state.running = running;
  el.runBtn.disabled = running;
  el.runBtn.classList.toggle("running", running);
  el.runBtnLabel.textContent = running ? t("running") : t("runPipeline");
  el.cancelBtn.classList.toggle("hidden", !running);
  if (el.chatSendBtn) el.chatSendBtn.disabled = running;
  if (el.chatInput) el.chatInput.disabled = running;
  el.workspaceModes?.querySelectorAll(".workspace-mode").forEach((btn) => {
    btn.disabled = running;
  });
}

el.cancelBtn.addEventListener("click", async () => {
  if (!state.jobId) return;
  el.cancelBtn.disabled = true;
  try { await fetch(`/api/cancel/${state.jobId}`, { method: "POST" }); }
  catch { /* the stream will surface the outcome */ }
  finally { el.cancelBtn.disabled = false; }
});

// ───────────────────────── output rendering ─────────────────────────

const panel = (name) => el.tabPanels.querySelector(`[data-panel="${name}"]`);
const hint = (text) => { const p = document.createElement("p"); p.className = "empty-hint"; p.textContent = text; return p; };

/** Live, unstyled text while an agent streams. */
function renderStreaming(agent, text) {
  const target = panel(AGENT_PANEL[agent]);
  if (!target) return;

  let box = target.querySelector(".report-text");
  if (!box) {
    box = document.createElement("div");
    box.className = "report-text streaming";
    target.replaceChildren(box);
  }
  box.classList.add("streaming");
  box.textContent = text;
  markTabContent(AGENT_PANEL[agent]);
}

/** Structured render once the agent has finished. */
function renderFinal(agent, result) {
  const name = AGENT_PANEL[agent];
  const target = panel(name);
  if (!target || !result) return;

  if (agent === "planner") {
    target.replaceChildren(...result.steps.map((step, i) => {
      const row = document.createElement("div");
      row.className = "plan-step";
      row.style.setProperty("--s", i);

      const num = document.createElement("span");
      num.className = "step-num";
      num.textContent = String(i + 1);

      const body = document.createElement("span");
      // The model usually numbers its own steps; don't render "1. 1. …".
      body.textContent = step.replace(/^\s*\d+[.)]\s*/, "");

      row.append(num, body);
      return row;
    }));

  } else if (agent === "vision") {
    target.replaceChildren(prose(result.description));

  } else if (agent === "research") {
    const frag = document.createDocumentFragment();

    const stats = document.createElement("div");
    stats.className = "stat-row";
    stats.append(
      stat(result.stats.words, t("words")),
      stat(result.stats.sentences, t("sentences")),
      stat(result.stats.avgWordsPerSentence, t("avgSent")),
      stat(result.usedReference ? t("reference") : t("topicSource"), t("source"), true),
    );
    frag.append(stats);

    if (result.keywords?.length) {
      frag.append(label(t("keywords")), chipRow(result.keywords.map((k) => [k.word, k.count]), "chip"));
    }
    if (result.phrases?.length) {
      frag.append(label(t("phrases")), chipRow(result.phrases.map((p) => [p.phrase, p.count]), "chip phrase"));
    }
    frag.append(label(t("findings")), prose(result.findings));
    target.replaceChildren(frag);

  } else if (agent === "writer") {
    target.replaceChildren(prose(result.report));

  } else if (agent === "reviewer") {
    const frag = document.createDocumentFragment();

    const badge = document.createElement("div");
    badge.className = `badge ${result.status}`;
    badge.textContent = result.status === "approved" ? t("approvedBadge") : t("needsRevisionBadge");
    frag.append(badge);

    if (result.reason) frag.append(prose(result.reason));
    if (!result.parsed) {
      frag.append(label(t("reviewNote")), text(t("reviewParseNote")));
    }
    target.replaceChildren(frag);
  }

  markTabContent(name);
}

function text(value) {
  const div = document.createElement("div");
  div.className = "report-text";
  div.textContent = value ?? "";
  return div;
}

/** Render agent prose as clean HTML — no visible **, ---, or # leftovers. */
function prose(value) {
  const div = document.createElement("div");
  div.className = "report-prose";
  div.innerHTML = formatProseHtml(value ?? "");
  return div;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatInline(escaped) {
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/**
 * Light formatter: turns model Markdown / noisy markers into readable HTML.
 * Safe: escapes first, then applies a small set of inline/block transforms.
 */
function formatProseHtml(raw) {
  const cleaned = String(raw)
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-_*]{3,}\s*$/gm, "")
    .replace(/^\s*\/{2,}.*$/gm, "")
    .replace(/^\s*```+\w*\s*$/gm, "")
    .trim();

  if (!cleaned) return "";

  const lines = cleaned.split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Bullet list
    if (/^[-*•]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(formatInline(escapeHtml(lines[i].trim().replace(/^[-*•]\s+/, ""))));
        i += 1;
      }
      blocks.push(`<ul>${items.map((it) => `<li>${it}</li>`).join("")}</ul>`);
      continue;
    }

    // Numbered list
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(formatInline(escapeHtml(lines[i].trim().replace(/^\d+[.)]\s+/, ""))));
        i += 1;
      }
      blocks.push(`<ol>${items.map((it) => `<li>${it}</li>`).join("")}</ol>`);
      continue;
    }

    // Section title: "Introduction:" or "**Report Title**" alone on a line
    const titlePlain = trimmed
      .replace(/^\*\*(.+)\*\*$/, "$1")
      .replace(/^__(.+)__$/, "$1");
    if (
      (titlePlain.length <= 80 && /[:：]\s*$/.test(titlePlain)) ||
      (titlePlain.length <= 70 && titlePlain === trimmed.replace(/^\*\*(.+)\*\*$/, "$1") && /^\*\*.+\*\*$/.test(trimmed))
    ) {
      const title = formatInline(escapeHtml(titlePlain.replace(/[:：]\s*$/, "")));
      blocks.push(`<h3>${title}</h3>`);
      i += 1;
      continue;
    }

    // Paragraph (merge wrapped lines until blank / list / title)
    const para = [trimmed];
    i += 1;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (!next) break;
      if (/^[-*•]\s+/.test(next) || /^\d+[.)]\s+/.test(next)) break;
      if (/^\*\*.+\*\*$/.test(next) || (/[:：]\s*$/.test(next) && next.length <= 80)) break;
      para.push(next);
      i += 1;
    }
    blocks.push(`<p>${formatInline(escapeHtml(para.join(" ")))}</p>`);
  }

  return blocks.join("");
}
function label(value) {
  const div = document.createElement("div");
  div.className = "section-label";
  div.textContent = value;
  return div;
}
function stat(value, name, plain = false) {
  const div = document.createElement("div");
  div.className = "stat";
  const b = document.createElement("b");
  b.textContent = plain ? value : Number(value).toLocaleString();
  div.append(b, document.createTextNode(name));
  return div;
}
function chipRow(pairs, className) {
  const row = document.createElement("div");
  row.className = "chips";
  pairs.forEach(([word, count], i) => {
    const chip = document.createElement("span");
    chip.className = className;
    chip.style.setProperty("--c", i);
    chip.append(document.createTextNode(word));
    const n = document.createElement("span");
    n.className = "n";
    n.textContent = `×${count}`;
    chip.append(n);
    row.append(chip);
  });
  return row;
}

function markTabContent(name) {
  const tab = el.tabs.querySelector(`[data-tab="${name}"]`);
  if (tab && !tab.classList.contains("active")) tab.classList.add("has-content");
}

/** Follows the active agent unless the user has taken manual control. */
function focusPanelFor(agent) {
  if (state.userPinnedTab) return;
  const name = AGENT_PANEL[agent];
  if (name) activateTab(name);
}

// ───────────────────────── tabs ─────────────────────────

el.tabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  state.userPinnedTab = true;
  activateTab(btn.dataset.tab);
});

function activateTab(name) {
  el.tabs.querySelectorAll(".tab").forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle("active", active);
    if (active) tab.classList.remove("has-content");
  });
  el.tabPanels.querySelectorAll(".tab-panel").forEach((p) => {
    p.classList.toggle("active", p.dataset.panel === name);
  });
  moveUnderline();
  const active = el.tabs.querySelector(".tab.active");
  if (active && typeof active.scrollIntoView === "function") {
    active.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }
}

function moveUnderline() {
  const active = el.tabs.querySelector(".tab.active");
  if (!active) return;
  el.tabUnderline.style.left = `${active.offsetLeft}px`;
  el.tabUnderline.style.width = `${active.offsetWidth}px`;
}

// ───────────────────────── image input ─────────────────────────

el.dropzone.addEventListener("click", () => el.imageInput.click());
el.dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.imageInput.click(); }
});
el.imageInput.addEventListener("change", () => acceptImage(el.imageInput.files[0]));

["dragenter", "dragover"].forEach((type) =>
  el.dropzone.addEventListener(type, (e) => { e.preventDefault(); el.dropzone.classList.add("dragover"); })
);
["dragleave", "drop"].forEach((type) =>
  el.dropzone.addEventListener(type, (e) => { e.preventDefault(); el.dropzone.classList.remove("dragover"); })
);
el.dropzone.addEventListener("drop", (e) => acceptImage(e.dataTransfer?.files?.[0]));

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function acceptImage(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    toast("err", t("unsupportedImage"), t("useImageTypes"));
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    toast("err", t("imageTooLarge"), t("imageLimit", { size: fmtBytes(file.size) }));
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    state.imageDataUrl = reader.result;
    el.dzPreview.src = reader.result;
    el.dzName.textContent = file.name;
    el.dzSize.textContent = fmtBytes(file.size);
    el.dzEmpty.classList.add("hidden");
    el.dzPreviewWrap.classList.remove("hidden");
    panel("vision").replaceChildren(hint(t("imageReady")));
  };
  reader.onerror = () => toast("err", t("couldNotRead"));
  reader.readAsDataURL(file);
}

el.removeImage.addEventListener("click", (e) => {
  e.stopPropagation();
  state.imageDataUrl = null;
  el.imageInput.value = "";
  el.dzEmpty.classList.remove("hidden");
  el.dzPreviewWrap.classList.add("hidden");
  panel("vision").replaceChildren(hint(t("emptyVision")));
});

// ───────────────────────── approval modal ─────────────────────────

function openModal(reason) {
  el.modalReason.textContent = reason || t("noReason");
  el.modal.classList.remove("hidden");
  el.btnRevise.focus();
}

async function resolveApproval(accept) {
  el.modal.classList.add("hidden");
  if (!state.jobId) return;
  try {
    await fetch(`/api/approval/${state.jobId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accept }),
    });
  } catch (err) {
    log(`${t("couldNotSendDecision")}: ${err.message}`, "err");
    toast("err", t("couldNotSendDecision"));
  }
}

el.btnAccept.addEventListener("click", () => resolveApproval(true));
el.btnRevise.addEventListener("click", () => resolveApproval(false));

// ───────────────────────── history ─────────────────────────

async function loadHistory() {
  try {
    const { runs } = await fetchJSON("/api/history");
    if (!runs.length) {
      el.historyList.replaceChildren(hint(t("noHistory")));
      return;
    }

    el.historyList.replaceChildren(...runs.map((run, i) => {
      const item = document.createElement("button");
      item.className = "history-item";
      item.style.setProperty("--h", i);

      const topic = document.createElement("div");
      topic.className = "history-topic";
      topic.textContent = run.topic;

      const meta = document.createElement("div");
      meta.className = "history-meta";
      meta.append(
        pill(run.status === "approved" ? t("approved") : t("needsRevision"), run.status),
        pill(fmtMs(run.durationMs)),
        pill(`${run.totalTokens} tok`),
        ...(run.mock ? [pill("mock", "mock")] : []),
        ...(run.language ? [pill(run.language.toUpperCase())] : []),
        pill(new Date(run.finishedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })),
      );

      item.append(topic, meta);
      item.addEventListener("click", () => openHistoryRun(run.id));
      return item;
    }));
  } catch {
    el.historyList.replaceChildren(hint(t("couldNotLoadHistory")));
  }
}

function pill(textValue, cls = "") {
  const span = document.createElement("span");
  span.className = `pill ${cls}`.trim();
  span.textContent = textValue;
  return span;
}

async function openHistoryRun(id) {
  try {
    const { run } = await fetchJSON(`/api/run/${id}`);
    state.lastRunId = run.id;
    el.exportBtn.disabled = false;

    renderFinal("planner", { steps: run.plan });
    renderFinal("research", run.research);
    renderFinal("writer", { report: run.report });
    renderFinal("reviewer", run.review);
    if (run.vision) renderFinal("vision", { description: run.vision });
    else panel("vision").replaceChildren(hint(t("noImageRun")));

    el.topic.value = run.topic;
    if (run.language && el.languageSelect) {
      I18N.set(run.language);
      el.languageSelect.value = I18N.get();
    }
    updateCharCount();
    state.userPinnedTab = true;
    if (state.workspace !== "research") setWorkspace("research", { silent: true });
    activateTab("report");
    expandResearchOutput();
    closeDrawer();
    toast("info", t("loadedHistory"), run.topic);
  } catch {
    toast("err", t("couldNotLoadRun"));
  }
}

function openDrawer() {
  loadHistory();
  el.drawer.classList.remove("hidden");
  el.drawerScrim.classList.remove("hidden");
}
function closeDrawer() {
  el.drawer.classList.add("hidden");
  el.drawerScrim.classList.add("hidden");
}

el.historyBtn.addEventListener("click", openDrawer);
el.closeDrawer.addEventListener("click", closeDrawer);
el.drawerScrim.addEventListener("click", closeDrawer);

// ───────────────────────── copy / export ─────────────────────────

el.exportBtn.addEventListener("click", () => {
  if (!state.lastRunId) return;
  window.location.href = `/api/run/${state.lastRunId}/markdown`;
  toast("ok", t("downloadingMd"));
});

el.copyOutput.addEventListener("click", async () => {
  const active = el.tabPanels.querySelector(".tab-panel.active");
  await copy(active?.innerText?.trim() ?? "", t("outputCopied"));
});

el.copyLog.addEventListener("click", async () => {
  await copy(el.consoleBody.innerText.trim(), t("logCopied"));
});

el.clearLog.addEventListener("click", () => {
  el.consoleBody.replaceChildren();
  log(t("logCleared"), "muted");
});

async function copy(value, okMessage) {
  if (!value) { toast("warn", t("nothingToCopy")); return; }
  try {
    await navigator.clipboard.writeText(value);
    toast("ok", okMessage);
  } catch {
    toast("err", t("clipboardBlocked"));
  }
}

// ───────────────────────── toasts ─────────────────────────

const TOAST_ICONS = {
  ok: "M20 6 9 17l-5-5", warn: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  err: "M18 6 6 18M6 6l12 12", info: "M12 16v-4M12 8h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
};

function toast(kind, message, hintText) {
  const node = document.createElement("div");
  node.className = `toast ${kind}`;

  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.innerHTML =
    `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ` +
    `stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${TOAST_ICONS[kind]}"/></svg>`;

  const body = document.createElement("div");
  body.className = "toast-body";
  body.append(document.createTextNode(message));
  if (hintText) {
    const small = document.createElement("span");
    small.className = "toast-hint";
    small.textContent = truncate(hintText, 120);
    body.append(small);
  }

  node.append(icon, body);
  el.toasts.append(node);

  const remove = () => {
    node.classList.add("out");
    node.addEventListener("animationend", () => node.remove(), { once: true });
  };
  setTimeout(remove, kind === "err" ? 7000 : 4200);
  node.addEventListener("click", remove);

  while (el.toasts.childElementCount > 4) el.toasts.firstElementChild.remove();
}

// ───────────────────────── keyboard ─────────────────────────

document.addEventListener("keydown", (e) => {
  // Cmd/Ctrl+Enter runs from anywhere, including inside the textareas.
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    if (state.workspace === "chat") sendChat();
    else el.runForm.requestSubmit();
    return;
  }

  if (e.key === "Escape") {
    if (!el.modal.classList.contains("hidden")) return; // the modal demands a real choice
    if (!el.drawer.classList.contains("hidden")) { closeDrawer(); return; }
    if (state.running) el.cancelBtn.click();
    return;
  }

  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? "");
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key.toLowerCase() === "h") { e.preventDefault(); el.drawer.classList.contains("hidden") ? openDrawer() : closeDrawer(); }
  if (e.key === "/") {
    e.preventDefault();
    (state.workspace === "chat" ? el.chatInput : el.topic)?.focus();
  }
});

// ───────────────────────── misc ─────────────────────────

el.topic.addEventListener("input", updateCharCount);
function updateCharCount() {
  const len = el.topic.value.length;
  el.topicCount.textContent = String(len);
  el.topicCount.classList.toggle("near-limit", len > 1800);
}

el.languageSelect?.addEventListener("change", () => {
  I18N.set(el.languageSelect.value);
  fetchStatus();
});

async function fetchJSON(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.message || payload.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function fmtMs(ms) {
  if (ms == null) return "—";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}
function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// Everything above is declarations only — safe to start now.
init();
