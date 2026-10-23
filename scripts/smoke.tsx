/**
 * End-to-end smoke test: renders the real UI against a scratch project.
 * The builder finds a failing test, fixes the bug and reruns; then the critic
 * roasts the diff. By default the models are scripted stand-ins, so no API key is
 * needed. With --live it uses the real models (and costs a little).
 *
 *   npm run smoke
 *   npm run smoke -- --live
 *   npm run smoke -- --theme=hustle     any theme; --theme=all runs each in turn
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import React from "react";
import { render } from "ink";

const live = process.argv.includes("--live");
const themeArg = process.argv.find((a) => a.startsWith("--theme="))?.slice("--theme=".length);
if (themeArg === "all") {
  // One child per theme, so each starts from a clean slate.
  const { spawnSync } = await import("node:child_process");
  const { THEMES } = await import("../src/theme/index.js");
  let failed = 0;
  for (const id of Object.keys(THEMES)) {
    console.log(`
=== ${id} ===`);
    const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1], `--theme=${id}`, ...(live ? ["--live"] : [])], { stdio: "inherit" });
    if (r.status !== 0) failed++;
  }
  process.exit(failed ? 1 : 0);
}
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "larper-smoke-"));
process.env.LARPER_HOME = path.join(scratch, ".home");
const project = path.join(scratch, "project");

const { Session } = await import("../src/session.js");
const { App } = await import("../src/ui/App.js");
const { createDemoProject, createScriptedClient, demoScripts } = await import("../src/testing/demo.js");
const { BANNER } = await import("../src/ui/components.js");
const { fill, theme } = await import("../src/theme/index.js");
const { hack } = await import("../src/game/hacks.js");

createDemoProject(project);
const session = new Session({ root: project, mute: true, theme: themeArg, client: live ? undefined : createScriptedClient(demoScripts()) });
let inputTokens = 0;
let outputTokens = 0;
session.bus.on("turn_end", (t) => {
  inputTokens += t.inputTokens;
  outputTokens += t.outputTokens;
});
const errors: string[] = [];
session.bus.on("error", (e) => errors.push(e.message));

// Fake terminal.
const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
let output = "";
const stdout = Object.assign(
  new Writable({
    write(chunk, _enc, cb) {
      output += chunk.toString();
      cb();
    },
  }),
  { columns: 100, rows: 60, isTTY: true },
);

const app = render(<App session={session} />, { stdin: stdin as any, stdout: stdout as any, debug: true, exitOnCtrlC: false, patchConsole: false });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const type = async (text: string) => {
  for (const ch of text) {
    stdin.write(ch);
    await sleep(5);
  }
  stdin.write("\r");
};
const waitIdle = async () => {
  await sleep(300);
  for (let i = 0; i < (live ? 3000 : 200) && session.busy; i++) {
    stdin.write("y"); // answer any Operator check
    await sleep(100);
  }
  await sleep(1500); // let the narrator's debounce fire
};

await sleep(300);
await type("fix the failing tests");
await waitIdle();
await type("/roast");
await waitIdle();
await type("/stats");
await sleep(300);
app.unmount();

const plain = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
// debug mode prints every frame; the last one holds the full transcript.
const frames = plain.split(BANNER[0]);
console.log(BANNER[0] + frames[frames.length - 1]);

// What the run should have printed, in the words of the theme it ran in.
const t = theme();
const flat = plain.replace(/\s+/g, " ");
const said = (template: string) => t.threats.some((foe) => [1, 2, 3].some((n) => flat.includes(fill(template, { foe, n }))));
const checks: Array<[string, boolean]> = [
  [`ran as ${t.name}`, plain.includes(`${t.name} · `)],
  ["bug fixed on disk", fs.readFileSync(path.join(project, "math.mjs"), "utf8").includes("a + b")],
  ["gate prompted", plain.includes(t.words.gate)],
  [`${t.words.foe} spawned`, said(t.lines.foeSpawn)],
  [`${t.words.foe} ${t.words.defeated}`, said(t.lines.foeDefeated)],
  [`${hack("first_blood").title} earned`, flat.includes(hack("first_blood").title)],
  ...(live ? [] : [[`${hack("cracked_ice").title} earned`, flat.includes(hack("cracked_ice").title)] as [string, boolean]]),
  ["no errors", errors.length === 0],
  [`${t.crew.narrator.title} narrated`, plain.includes(`${t.crew.narrator.title}:`)],
  ["profile saved", fs.existsSync(path.join(process.env.LARPER_HOME!, "profile.json"))],
];
if (errors.length) console.log("Errors:\n" + errors.join("\n"));
if (live) console.log(`Tokens: ~${inputTokens} in, ${outputTokens} out`);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
fs.rmSync(scratch, { recursive: true, force: true });
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
