// Larper desktop renderer. Talks to the main process only through
// window.larper (see preload.cjs). All model text is escaped before display.

const api = window.larper;
const $ = (id) => document.getElementById(id);
const RING = 2 * Math.PI * 84; // circumference of the arena ring

// [while running, when done]
const TOOL_LABELS = {
  read_file: ["Reading", "Read"],
  write_file: ["Writing", "Wrote"],
  edit_file: ["Editing", "Edited"],
  glob: ["Finding files", "Found files"],
  grep: ["Searching code", "Searched code"],
  shell: ["Running", "Ran"],
  run_tests: ["Running tests", "Ran tests"],
};
const TOOL_NAMES = { read_file: "reading", write_file: "writing files", edit_file: "editing", glob: "finding files", grep: "searching", shell: "commands", run_tests: "running tests" };
const VERBS = { shell: "run a command", run_tests: "run the tests", write_file: "write a file", edit_file: "edit a file" };

let state = null; // snapshot from the main process, including the current theme
let busy = false;
let live = null; // the crew currently speaking: { crew, md, text, thinking }
const steps = new Map(); // tool_use id -> row
let tick = 0;

// ---------- helpers ----------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ic");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** A small, safe Markdown subset: code blocks, inline code, bold, italics, headings, lists. */
function markdown(src) {
  const blocks = [];
  const text = escapeHtml(src.trim()).replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre><code>${code.replace(/\n$/, "")}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  const inline = (s) =>
    s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  const out = [];
  for (const para of text.split(/\n{2,}/)) {
    const lines = para.split("\n");
    if (/^\u0000\d+\u0000$/.test(para.trim())) out.push(para.trim());
    else if (lines.every((l) => /^\s*[-*] /.test(l))) out.push(`<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ""))}</li>`).join("")}</ul>`);
    else if (lines.every((l) => /^\s*\d+[.)] /.test(l))) out.push(`<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)] /, ""))}</li>`).join("")}</ol>`);
    else if (/^#{1,3} /.test(para)) out.push(`<h3>${inline(para.replace(/^#{1,3} /, ""))}</h3>`);
    else out.push(`<p>${inline(para).replace(/\n/g, "<br>")}</p>`);
  }
  return out.join("").replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]);
}

const persona = (crew) => state.personas[crew];
const T = () => state.theme;
const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** Fill a theme template's {placeholders}; {s} pluralises against {n}. */
function fill(template, vars = {}) {
  const all = { s: vars.n === 1 ? "" : "s", ...vars };
  return template.replace(/\{(\w+)\}/g, (_, k) => String(all[k] ?? ""));
}

function scrollDown(force = false) {
  const t = $("transcript");
  if (force || t.scrollHeight - t.scrollTop - t.clientHeight < 240) {
    requestAnimationFrame(() => (t.scrollTop = t.scrollHeight));
  }
}

function append(node) {
  document.querySelector(".empty")?.remove();
  $("transcript").appendChild(node);
  scrollDown();
  return node;
}

function line(cls, text) {
  return append(el("div", cls, text));
}

// ---------- the crew speaking ----------

const SCRAMBLE = "▓▒░█<>/\\|_-=+*#%01";
const calm = () => document.body.classList.contains("no-anim") || matchMedia("(prefers-reduced-motion: reduce)").matches;

function startLive(crew) {
  live = { crew, md: null, text: "", shown: 0, thinking: "" };
}

/** Freeze what was streamed so far; the next words start a new message. */
function flushLive() {
  if (live) {
    if (live.md) drawLive(live.text.length, false);
    live.md = null;
    live.text = "";
    live.shown = 0;
  }
}

function renderLive() {
  if (!live || !live.text.trim()) return;
  if (!live.md) {
    const p = persona(live.crew);
    const msg = el("div", "msg");
    msg.style.setProperty("--crew", p.color);
    const who = el("div", "who");
    who.appendChild(el("span", "dot"));
    who.appendChild(el("span", "", p.title));
    msg.appendChild(who);
    live.md = el("div", "md");
    msg.appendChild(live.md);
    append(msg);
  }
  if (!revealing) {
    revealing = true;
    requestAnimationFrame(reveal);
  }
}

let revealing = false;

/**
 * Type the streamed text out a few characters per frame. The step grows with
 * the backlog, so a burst of tokens is caught up within a few frames.
 */
function reveal() {
  if (!live || !live.md) {
    revealing = false;
    return;
  }
  const backlog = live.text.length - live.shown;
  if (backlog === 0) {
    // Caught up: leave the caret blinking; the next delta restarts the loop.
    revealing = false;
    return;
  }
  live.shown += calm() ? backlog : Math.max(2, Math.ceil(backlog / 6));
  live.shown = Math.min(live.shown, live.text.length);
  drawLive(live.shown, true);
  requestAnimationFrame(reveal);
}

function drawLive(n, streaming) {
  let text = live.text.slice(0, n);
  // The critic ends with a protocol line for the harness; show it as a tag instead.
  const verdict = streaming ? null : text.match(/VERDICT:\s*(APPROVED|REVISE)/i);
  text = streaming ? text.replace(/\n\s*VERDICT[\s\S]*$/i, "") : text.replace(/\n?\s*VERDICT:\s*(APPROVED|REVISE)\s*$/i, "");
  live.md.innerHTML = markdown(text);
  if (streaming && !calm()) {
    // The leading edge: a few scrambling glyphs while text is still arriving, then a blinking block.
    let host = live.md.lastElementChild ?? live.md;
    while (["UL", "OL", "PRE"].includes(host.tagName) && host.lastElementChild) host = host.lastElementChild;
    if (n < live.text.length) {
      const k = Math.min(4, live.text.length - n);
      host.appendChild(el("span", "scramble", Array.from({ length: k }, () => SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)]).join("")));
    }
    host.appendChild(el("span", "caret"));
  }
  if (verdict) {
    const approved = verdict[1].toUpperCase() === "APPROVED";
    live.md.appendChild(el("span", `verdict ${approved ? "approved" : "revise"}`, approved ? "Approved" : "Wants changes"));
  }
  scrollDown();
}

function setWorking(crew) {
  const w = $("working");
  if (!crew) {
    w.hidden = true;
    return;
  }
  const p = persona(crew);
  w.hidden = false;
  w.style.setProperty("--crew", p.color);
  const flavour = p.workingLines[Math.floor(tick / 30) % p.workingLines.length];
  const dots = Math.floor(tick / 5) % 4;
  $("working-text").textContent = `${p.title} is ${flavour}${".".repeat(dots)}${" ".repeat(3 - dots)}`;
  const thought = live?.thinking?.replace(/\s+/g, " ").trim();
  $("working-thought").textContent = thought ? thought.slice(-140) : "";
}

// ---------- rank, arena, hacks, record ----------

function rankInfo(xp) {
  let rank = state.ranks[0];
  for (const r of state.ranks) if (xp >= r.min) rank = r;
  const next = state.ranks[state.ranks.indexOf(rank) + 1] ?? null;
  return { rank, next, fraction: next ? (xp - rank.min) / (next.min - rank.min) : 1 };
}

function renderRank() {
  const { rank, next, fraction } = rankInfo(state.xp);
  $("rank-name").textContent = rank.name;
  $("xp-fill").style.width = `${Math.round(fraction * 100)}%`;
  $("xp-label").textContent = String(state.xp);
  const xp = T().words.xp;
  $("rank").title = next ? `${state.xp} ${xp}. ${next.min - state.xp} more to reach ${next.name}.` : `${state.xp} ${xp}. The highest rank: ${T().lines.topRank}.`;
  $("rank").hidden = state.serious;
}

function floatXp(amount) {
  const f = $("xp-float");
  f.textContent = `${amount > 0 ? "+" : "−"}${Math.abs(amount)}`;
  f.className = `xp-float${amount < 0 ? " loss" : ""}`;
  void f.offsetWidth;
  f.classList.add("show");
}

function renderStats() {
  const s = state.stats;
  const w = T().words;
  const rows = [
    ["Tests fixed", s.testsFixed],
    [`${cap(w.foes)} ${w.defeated}`, s.bossesDefeated],
    [`${cap(w.jobs)} done`, s.tasks],
    [`${persona("critic").title} approvals`, s.reviewsPassed],
    ["Sessions", s.sessions],
  ];
  const dl = $("stats");
  dl.replaceChildren();
  for (const [k, v] of rows) {
    dl.appendChild(el("dt", "", k));
    dl.appendChild(el("dd", "", String(v)));
  }
}

function renderHacks(freshId) {
  const ul = $("hacks");
  ul.replaceChildren();
  for (const l of state.hacks) {
    const li = el("li", `${l.earned ? "earned" : ""}${l.id === freshId ? " fresh" : ""}`);
    li.title = `${l.description}. Worth ${l.reward} ${T().words.xp}.`;
    li.appendChild(el("span", "pip"));
    li.appendChild(el("span", "", l.title));
    ul.appendChild(li);
  }
  $("hack-count").textContent = `${state.hacks.filter((l) => l.earned).length} of ${state.hacks.length}`;
}

function setRing(fraction) {
  $("ring-hp").style.strokeDashoffset = String(RING * (1 - Math.max(0, Math.min(1, fraction))));
}

function pulseArena(cls) {
  const a = $("arena");
  a.classList.remove("hit", "grow", "won");
  void a.offsetWidth;
  a.classList.add(cls);
}

function renderArena(boss, change) {
  const a = $("arena");
  if (change === "defeated") {
    a.classList.remove("fighting");
    setRing(1);
    $("foe-name").textContent = `${boss?.name ?? cap(T().words.foe)} ${T().words.defeated}`;
    $("foe-hp").textContent = "All tests pass";
    pulseArena("won");
    setTimeout(() => {
      if (state.boss) return; // a new fight began meanwhile
      a.classList.remove("won");
      $("foe-name").textContent = T().lines.allClear;
      $("foe-hp").textContent = T().lines.noFoe;
    }, 3000);
    return;
  }
  if (!boss) {
    a.classList.remove("fighting");
    setRing(1);
    $("foe-name").textContent = T().lines.allClear;
    $("foe-hp").textContent = T().lines.noFoe;
    return;
  }
  a.classList.add("fighting");
  setRing(boss.hp / boss.maxHp);
  $("foe-name").textContent = boss.name;
  $("foe-hp").textContent = `${boss.hp} of ${boss.maxHp} test${boss.maxHp === 1 ? "" : "s"} failing`;
  if (change === "hit" || change === "grow") pulseArena(change);
}

function renderTools() {
  const sound = $("toggle-sound");
  sound.querySelector("use").setAttribute("href", state.sound ? "#i-sound" : "#i-sound-off");
  sound.title = state.sound ? "Sound on" : "Sound off";
  $("toggle-tts").classList.toggle("on", state.tts);
  $("toggle-tts").title = `${persona("narrator").title} reads its lines aloud (${state.tts ? "on" : "off"})`;
  $("toggle-serious").classList.toggle("on", state.serious);
  $("toggle-serious").title = state.serious ? "Serious mode is on" : "Serious mode: no game, no narration";
  $("project-path").textContent = state.root;
  $("project").title = `${state.root}\nChoose another project folder`;
  $("demo-badge").hidden = !state.demo;
  document.querySelector(".rail").hidden = state.serious;
}

/** Dress the window in the current theme: palette (style.css), names and every fixed label. */
function applyTheme() {
  const t = T();
  const w = t.words;
  document.documentElement.dataset.theme = t.id;
  document.body.style.setProperty("--narrator", persona("narrator").color);
  $("theme-picker").value = t.id;
  $("theme-picker").title = `Theme: ${t.name}. ${t.tagline}`;
  $("hacks-title").firstChild.textContent = `${cap(w.achievements)} `;
  $("prompt").placeholder = `${t.lines.placeholder} Or type / for commands`;
  $("plan-shortcut").textContent = cap(w.plan);
  $("plan-shortcut").dataset.insert = `/${w.plan} `;
  $("upgrade-sub").textContent = t.lines.rankUpTitle;
  const empty = document.querySelector(".empty");
  if (empty) {
    $("empty-title").textContent = t.lines.placeholder;
    $("empty-sub").textContent = t.lines.emptySub;
  }
  document.title = `Larper · ${t.name}`;
}

function renderAll() {
  applyTheme();
  renderRank();
  renderHacks();
  renderStats();
  renderTools();
  renderArena(state.boss, "none");
}

// ---------- events from the crew ----------

const handlers = {
  turn_start({ crew }) {
    startLive(crew);
    setWorking(crew);
  },
  text({ delta }) {
    if (!live) return;
    live.text += delta;
    renderLive();
  },
  thinking({ delta }) {
    if (live) live.thinking = (live.thinking + delta).slice(-400);
  },
  tool_start({ id, name, summary }) {
    flushLive();
    const row = el("div", "step running");
    row.appendChild(el("span", "state"));
    row.dataset.tool = name;
    row.appendChild(el("span", "step-name", TOOL_LABELS[name]?.[0] ?? name));
    row.appendChild(el("span", "step-arg", summary));
    steps.set(id, append(row));
  },
  tool_end({ id, ok, summary }) {
    const row = steps.get(id);
    steps.delete(id);
    if (!row) return;
    row.className = `step ${ok ? "ok" : "failed"}`;
    row.querySelector(".step-name").textContent = TOOL_LABELS[row.dataset.tool]?.[1] ?? row.dataset.tool;
    row.querySelector(".state").appendChild(icon(ok ? "check" : "cross"));
    if (!ok && summary) row.after(el("div", "step-error", summary));
  },
  turn_end() {
    flushLive();
    live = null;
    setWorking(null);
  },
  notice({ text }) {
    line(text.includes("\n") ? "note block" : "note", text);
  },
  error({ message }) {
    line("fail", message);
  },
  narration({ text }) {
    const n = el("div", "radio");
    n.appendChild(el("b", "", `${persona("narrator").title} `));
    n.appendChild(document.createTextNode(text));
    append(n);
  },
  xp({ amount, reason, total }) {
    state.xp = total;
    renderRank();
    floatXp(amount);
    if (amount < 0) line("event foe", `${T().lines.regression} ${amount} ${T().words.xp}.`);
  },
  hack(hack) {
    const l = state.hacks.find((x) => x.id === hack.id);
    if (l) l.earned = true;
    renderHacks(hack.id);
    const row = el("div", "hack-line");
    row.appendChild(icon("unlock"));
    const text = el("div");
    text.appendChild(el("strong", "", hack.title));
    text.appendChild(el("span", "hack-desc", hack.description));
    row.appendChild(text);
    row.appendChild(el("span", "gain", `+${hack.reward}`));
    append(row);
  },
  rank_up({ rank }) {
    $("upgrade-rank").textContent = rank;
    $("upgrade").hidden = false;
    setTimeout(() => ($("upgrade").hidden = true), 3200);
  },
  theme() {
    // The snapshot that comes back from the /theme command carries the new theme; nothing to do until then.
  },
  boss({ boss, change }) {
    if (state.serious || !boss || change === "none") return;
    state.boss = change === "defeated" ? null : boss;
    renderArena(boss, change);
    const l = T().lines;
    const template = { spawn: l.foeSpawn, grow: l.foeGrow, hit: l.foeHit, defeated: l.foeDefeated }[change];
    line(`event ${change === "defeated" ? "won" : "foe"}`, fill(template, { foe: boss.name, n: boss.hp }));
  },
};

// ---------- the Operator check ----------

const gateQueue = [];

function showGate() {
  const next = gateQueue[0];
  if (!next) {
    $("gate").hidden = true;
    $("prompt").focus();
    return;
  }
  const { req } = next;
  $("gate-title").textContent = `Allow ${persona(req.crew).title} to ${VERBS[req.tool] ?? req.tool}?`;
  $("gate-detail").textContent = req.detail;
  $("gate-risk").hidden = !req.risky;
  $("gate-eyebrow").textContent = req.risky ? `${T().words.gate} · high risk` : T().words.gate;
  $("gate-risk").textContent = T().lines.risky;
  $("gate-tool").textContent = TOOL_NAMES[req.tool] ?? req.tool;
  document.querySelector(".gate").classList.toggle("risky", req.risky);
  $("gate").hidden = false;
  $("gate-yes").focus();
}

function answerGate(answer) {
  const next = gateQueue.shift();
  if (!next) return;
  api.approve(next.id, answer);
  if (answer === "always") line("note", `${persona(next.req.crew).title} may keep ${TOOL_NAMES[next.req.tool] ?? next.req.tool} without asking, for the rest of this session.`);
  if (answer === "no") line("note", `${T().lines.gateNo} ${next.req.summary}`);
  showGate();
}

// ---------- input ----------

function setBusy(b) {
  busy = b;
  $("prompt").disabled = b;
  $("send").disabled = b;
  document.querySelectorAll(".shortcut").forEach((c) => (c.disabled = b));
  $("theme-picker").disabled = b;
  if (!b) $("prompt").focus();
}

async function submit(raw) {
  const text = raw.trim();
  if (!text || busy) return;
  $("prompt").value = "";
  autosize();
  const you = el("div", "you");
  you.appendChild(el("p", "", text));
  append(you);
  scrollDown(true);
  setBusy(true);
  try {
    const before = state.theme.id;
    state = await api.submit(text);
    if (state.theme.id !== before) renderAll();
    renderTools();
    renderRank();
    renderStats();
  } catch (err) {
    line("fail", String(err?.message ?? err));
  } finally {
    setBusy(false);
    setWorking(null);
  }
}

function autosize() {
  const t = $("prompt");
  t.style.height = "auto";
  t.style.height = `${Math.min(t.scrollHeight, 200)}px`;
}

function wire() {
  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    void submit($("prompt").value);
  });
  $("prompt").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit($("prompt").value);
    }
  });
  $("prompt").addEventListener("input", autosize);
  document.querySelectorAll(".shortcut").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.run) void submit(b.dataset.run);
      else {
        $("prompt").value = b.dataset.insert;
        $("prompt").focus();
      }
    }),
  );
  $("stop").addEventListener("click", () => api.interrupt());
  $("toggle-sound").addEventListener("click", () => void submit("/mute"));
  $("toggle-tts").addEventListener("click", () => void submit("/tts"));
  $("toggle-serious").addEventListener("click", () => void submit("/serious"));
  $("theme-picker").addEventListener("change", (e) => {
    const id = e.target.value;
    if (busy || id === state.theme.id) {
      e.target.value = state.theme.id;
      return;
    }
    void submit(`/theme ${id}`);
  });
  $("project").addEventListener("click", async () => {
    if (busy) return;
    const snap = await api.pickFolder();
    if (!snap) return;
    state = snap;
    renderAll();
    line("note", `Now working in ${state.root}`);
  });
  $("gate-yes").addEventListener("click", () => answerGate("yes"));
  $("gate-always").addEventListener("click", () => answerGate("always"));
  $("gate-no").addEventListener("click", () => answerGate("no"));
  $("upgrade").addEventListener("click", () => ($("upgrade").hidden = true));

  document.addEventListener("keydown", (e) => {
    if (!$("gate").hidden) {
      const k = e.key.toLowerCase();
      if (k === "y") answerGate("yes");
      else if (k === "a") answerGate("always");
      else if (k === "n" || k === "escape") answerGate("no");
      return;
    }
    if (e.key === "Escape" && busy) api.interrupt();
  });
}

// ---------- start ----------

function fillThemePicker() {
  const pick = $("theme-picker");
  pick.replaceChildren(...state.themes.map((t) => Object.assign(el("option", "", t.name), { value: t.id, title: t.tagline })));
}

async function main() {
  state = await api.init();
  fillThemePicker();
  renderAll();
  wire();
  api.onEvent((name, payload) => handlers[name]?.(payload));
  api.onApproval((id, req) => {
    flushLive();
    gateQueue.push({ id, req });
    if (gateQueue.length === 1) showGate();
  });
  setInterval(() => {
    tick++;
    if (live) setWorking(live.crew);
  }, 80);
  $("prompt").focus();
}

void main();
