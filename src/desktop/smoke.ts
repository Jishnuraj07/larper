import fs from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";
import type { Session } from "../session.js";
import { THEMES, fill, theme } from "../theme/index.js";
import { hack } from "../game/hacks.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Drive the real window through the demo: type a task, answer the approval check
 * by clicking, wait for the crew, then roast; then switch through every theme.
 * Screenshots go to shotsDir if given.
 * Returns the process exit code.
 */
export async function runDesktopSmoke({ win, session, shotsDir }: { win: BrowserWindow; session: Session; shotsDir?: string }): Promise<number> {
  const errors: string[] = [];
  win.webContents.on("console-message", (details) => {
    if (details.level === "error") errors.push(details.message);
  });
  session.bus.on("test_result", (r) => console.log(`test_result: ${r.failed} failed, ${r.passed} passed (parsed: ${r.parsed})`));
  session.bus.on("tool_end", (t) => console.log(`tool ${t.name}: ${t.ok ? "ok" : "failed"} · ${t.summary}`));
  const js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>;
  const shot = async (name: string) => {
    if (!shotsDir) return;
    fs.mkdirSync(shotsDir, { recursive: true });
    // A hidden window only repaints on demand; ask for a fresh frame first.
    win.webContents.invalidate();
    await sleep(300);
    win.webContents.invalidate();
    await sleep(300);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(shotsDir, `${name}.png`), image.toPNG());
  };
  const send = (text: string) =>
    js(`(() => { const p = document.getElementById("prompt"); p.value = ${JSON.stringify(text)}; document.getElementById("send").click(); })()`);

  let gateShot = false;
  let prompts = 0;
  const runTurn = async (text: string) => {
    await send(text);
    await sleep(300);
    for (let i = 0; i < 600 && (session.busy || (await js<boolean>(`!document.getElementById("gate").hidden`))); i++) {
      if (await js<boolean>(`!document.getElementById("gate").hidden`)) {
        prompts++;
        if (!gateShot) {
          gateShot = true;
          await sleep(300);
          await shot("2-gate");
        } else if (prompts === 2) {
          // The threat is up by now; show the arena without the dialog over it.
          await js(`document.getElementById("gate").hidden = true`);
          await shot("2b-fight");
          await js(`document.getElementById("gate").hidden = false`);
        }
        await js(`document.getElementById("gate-yes").click()`);
      }
      await sleep(100);
    }
    await sleep(1500); // narrator debounce, animations
  };

  await sleep(800);
  await js(`document.body.classList.add("no-anim")`);
  await shot("1-start");
  await runTurn("fix the failing tests");
  await js(`document.getElementById("upgrade").hidden = true`);
  await sleep(300);
  await shot("3-fixed");
  await runTurn("/roast");
  await shot("4-roast");

  const t = theme();
  const text = await js<string>("document.getElementById('transcript').innerText");
  const hacks = await js<string>("[...document.querySelectorAll('.hack-line')].map((e) => e.textContent).join(' | ')");
  const ring = await js<string>("document.getElementById('foe-name').textContent");
  // Transcript order: the threat must appear before it is purged, and the final reply after both.
  const order = (needle: string) => text.indexOf(needle);
  const spawned = fill(t.lines.foeSpawn, { foe: t.threats[1], n: 2 });
  const defeated = fill(t.lines.foeDefeated, { foe: t.threats[1], n: 0 });
  const checks: Array<[string, boolean]> = [
    ["bug fixed on disk", fs.readFileSync(path.join(session.root, "math.mjs"), "utf8").includes("a + b")],
    ["gate shown", gateShot],
    [`${t.words.foe} appeared`, text.includes(spawned)],
    [`${t.words.foe} ${t.words.defeated}`, text.includes(defeated)],
    ["arena back to all clear", ring === t.lines.allClear || ring.endsWith(t.words.defeated)],
    [`${hack("first_blood").title} in transcript`, hacks.includes(hack("first_blood").title)],
    [`${hack("cracked_ice").title} earned`, hacks.includes(hack("cracked_ice").title)],
    [`${t.crew.builder.title} replied`, text.includes("Done and dusted")],
    [`${t.crew.narrator.title} narrated`, (await js<number>("document.querySelectorAll('.radio').length")) > 0],
    ["transcript in order", order(spawned) < order(defeated) && order(defeated) < order("Done and dusted")],
    [`rank shown as ${t.ranks[1].name}`, (await js<string>(`document.getElementById("rank-name").textContent`)) === t.ranks[1].name],
  ];

  // Typing a slash opens the command menu; arrows pick, Tab completes.
  const key = (k: string) => js(`document.getElementById("prompt").dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`);
  await js(`(() => { const p = document.getElementById("prompt"); p.focus(); p.value = "/h"; p.dispatchEvent(new Event("input")); })()`);
  await shot("4b-menu");
  const rows = await js<string[]>(`[...document.querySelectorAll("#menu .menu-name")].map((e) => e.textContent)`);
  await key("ArrowDown");
  await key("ArrowDown");
  await key("Tab");
  const completed = await js<string>(`document.getElementById("prompt").value`);
  const narrowed = await js<string>(`document.getElementById("menu").innerText`);
  await js(`document.getElementById("prompt").value = ""`);
  checks.push(["command menu completes", rows.join(" ") === `/${t.words.plan} /${t.words.achievements} /help` && completed === "/help" && narrowed.trim().startsWith("/help") && !narrowed.includes("/heist")]);

  // Every theme restyles the window and renames what is on it, progress and all.
  const start = t.id;
  for (const id of [...Object.keys(THEMES).filter((k) => k !== start), start]) {
    // Animations on before the switch, so the theme fills its ambience.
    await js(`document.body.classList.remove("no-anim")`);
    await send(`/theme ${id}`);
    await sleep(700);
    const applied = await js<string>("document.documentElement.dataset.theme");
    const rank = await js<string>(`document.getElementById("rank-name").textContent`);
    checks.push([`switched to ${id}`, applied === id && rank === THEMES[id as keyof typeof THEMES].ranks[1].name]);
    // Show the theme's effects mid-flight: a hit on a foe and an achievement toast.
    const foe = { name: theme().threats[2], tier: 2, hp: 2, maxHp: 5, startHp: 5 };
    session.bus.emit("boss", { boss: foe, change: "hit" });
    session.bus.emit("hack", hack("uptime"));
    await sleep(1200); // the hidden window repaints late; give the effects a frame
    await shot(`5-theme-${id}`);
    session.bus.emit("boss", { boss: { ...foe, hp: 0 }, change: "defeated" });
    await sleep(500);
    await js(`document.body.classList.add("no-anim")`);
  }
  checks.push(["no renderer errors", errors.length === 0]);
  for (const e of errors) console.log(`renderer error: ${e}`);
  for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  return checks.every(([, ok]) => ok) ? 0 : 1;
}
