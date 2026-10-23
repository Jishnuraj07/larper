/**
 * Larper desktop: an Electron window over the same Session the terminal UI
 * uses. The main process runs the crew, the game and the sound; it forwards
 * every bus event to the window and relays the user's input and Operator answers
 * back.
 *
 *   npm run desktop                 open the last project (or pick one)
 *   npm run desktop -- --demo       scripted demo project, no API key needed
 *   npm run desktop -- --cwd=DIR    open DIR
 *   npm run desktop -- --theme=NAME start in a theme (netrunner, olympus, dungeon, starship, hustle)
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Session, type ApprovalAnswer } from "../session.js";
import { larperHome } from "../config.js";
import type { EventName } from "../events.js";
import { allHacks } from "../game/hacks.js";
import { ranks } from "../game/ranks.js";
import { personas } from "../agent/personas.js";
import { THEMES } from "../theme/index.js";
import { commandList } from "../commands.js";
import { createDemoProject, createScriptedClient, demoScripts } from "../testing/demo.js";
import { runDesktopSmoke } from "./smoke.js";

const appRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const EVENTS: EventName[] = [
  "turn_start", "text", "thinking", "tool_start", "tool_end", "approval", "edit", "shell_result", "test_result",
  "review", "turn_end", "error", "notice", "xp", "rank_up", "hack", "boss", "narration", "theme",
];

const argv = process.argv.slice(1);
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const smoke = flag("smoke");
const demo = flag("demo") || smoke;
if (smoke) process.env.LARPER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "larper-desktop-home-"));

let win: BrowserWindow | null = null;
let session: Session | null = null;
let unsubscribe: Array<() => void> = [];
const pendingApprovals = new Map<number, (a: ApprovalAnswer) => void>();
let nextApproval = 1;
let markReady: () => void = () => {};
let themeFlag = option("theme");
const sessionReady = new Promise<void>((r) => (markReady = r));

// --- Remembering the last project -------------------------------------------

const prefsFile = () => path.join(larperHome(), "desktop.json");

function lastProject(): string | null {
  try {
    const p = JSON.parse(fs.readFileSync(prefsFile(), "utf8")).lastProject as string;
    return p && fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

function rememberProject(root: string): void {
  if (demo) return;
  try {
    fs.mkdirSync(larperHome(), { recursive: true });
    fs.writeFileSync(prefsFile(), JSON.stringify({ lastProject: root }, null, 2));
  } catch {
    // Not worth failing over.
  }
}

// --- Session ------------------------------------------------------------------

function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function openSession(root: string): void {
  unsubscribe.forEach((u) => u());
  session?.interrupt();
  session?.engine.dispose();
  for (const resolve of pendingApprovals.values()) resolve("no");
  pendingApprovals.clear();

  session = new Session({
    root,
    mute: smoke,
    theme: themeFlag,
    client: demo ? createScriptedClient(demoScripts(), smoke ? 150 : 700) : undefined,
  });
  unsubscribe = EVENTS.map((name) => session!.bus.on(name, (payload) => send("larper:event", name, payload)));
  session.setApprovalHandler(
    (req) =>
      new Promise<ApprovalAnswer>((resolve) => {
        const id = nextApproval++;
        pendingApprovals.set(id, resolve);
        send("larper:approval", id, req);
      }),
  );
  rememberProject(root);
  // --theme picks the first session's theme; after that the user's own switches stand.
  themeFlag = undefined;
}

export function snapshot() {
  const s = session!;
  const p = s.engine.profile;
  return {
    root: s.root,
    demo,
    serious: s.serious,
    sound: s.sound,
    tts: s.tts,
    busy: s.busy,
    xp: p.xp,
    stats: p.stats,
    boss: s.engine.boss,
    theme: s.theme,
    themes: Object.values(THEMES).map((t) => ({ id: t.id, name: t.name, tagline: t.tagline })),
    commands: commandList(),
    ranks: ranks(),
    personas: personas(),
    hacks: allHacks().map((h) => ({ ...h, earned: Boolean(p.hacks[h.id]) })),
  };
}

export type Snapshot = ReturnType<typeof snapshot>;

async function pickFolder(): Promise<string | null> {
  const result = await dialog.showOpenDialog(win!, {
    title: "Choose the project the crew will work on",
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
}

function demoRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "larper-demo-"));
  createDemoProject(dir);
  return dir;
}

// --- IPC ----------------------------------------------------------------------

ipcMain.handle("larper:init", async () => {
  await sessionReady;
  return snapshot();
});

ipcMain.handle("larper:submit", async (_e, line: string) => {
  const result = await session!.submit(String(line));
  if (result === "quit") app.quit();
  return snapshot();
});

ipcMain.on("larper:interrupt", () => session?.interrupt());

ipcMain.on("larper:approve", (_e, id: number, answer: ApprovalAnswer) => {
  const resolve = pendingApprovals.get(id);
  pendingApprovals.delete(id);
  resolve?.(answer === "yes" || answer === "always" ? answer : "no");
});

ipcMain.handle("larper:pickFolder", async () => {
  if (session?.busy) return null;
  const dir = await pickFolder();
  if (!dir) return null;
  openSession(dir);
  return snapshot();
});

// --- Window -------------------------------------------------------------------

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: !smoke,
    backgroundColor: "#171927",
    title: "Larper",
    icon: path.join(appRoot, "desktop", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(appRoot, "desktop", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The hidden smoke-test window would otherwise freeze animations mid-frame.
      backgroundThrottling: !smoke,
    },
  });

  // Links open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.on("closed", () => {
    session?.interrupt();
    win = null;
  });

  await win.loadFile(path.join(appRoot, "desktop", "renderer", "index.html"));
}

app.whenReady().then(async () => {
  let root = option("cwd") ? path.resolve(option("cwd")!) : demo ? demoRoot() : lastProject();
  await createWindow();
  if (!root) root = (await pickFolder()) ?? os.homedir();
  openSession(root);
  markReady();

  if (smoke) {
    const code = await runDesktopSmoke({ win: win!, session: session!, shotsDir: option("shots") });
    app.exit(code);
  }
});

app.on("window-all-closed", () => app.quit());
