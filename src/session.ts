import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { Bus } from "./events.js";
import { loadConfig, saveTheme, type Config } from "./config.js";
import { Agent, describeError } from "./agent/loop.js";
import { READ_ONLY_TOOLS, type ApprovalRequest } from "./agent/tools.js";
import { runHeist, runRoast, type Crew } from "./agent/council.js";
import { GameEngine } from "./game/engine.js";
import { loadProfile } from "./game/profile.js";
import { allHacks } from "./game/hacks.js";
import { progress } from "./game/ranks.js";
import { streak } from "./game/profile.js";
import { THEMES, fill, findTheme, setTheme, theme, type Theme } from "./theme/index.js";
import { Narrator } from "./narrator.js";
import { play } from "./audio/earcons.js";
import { speak, stopSpeaking } from "./audio/tts.js";

export type ApprovalAnswer = "yes" | "always" | "no";

export interface SessionOptions {
  root: string;
  serious?: boolean;
  mute?: boolean;
  yolo?: boolean;
  /** A theme for this session only, by id, name or alias. Otherwise the one in config.json. */
  theme?: string;
  /** Use this client instead of building one (the scripted demo, tests). */
  client?: Anthropic;
}

/** Everything behind the UI: the crew, the game, the narrator and the sound. */
export class Session {
  readonly bus = new Bus();
  readonly config: Config;
  readonly engine: GameEngine;
  readonly root: string;
  serious: boolean;
  sound: boolean;
  tts: boolean;
  busy = false;

  private client: Anthropic | null = null;
  private crew: Crew | null = null;
  private narrator: Narrator;
  private abort: AbortController | null = null;
  private alwaysAllow = new Set<string>();
  private yolo: boolean;
  private askUser: ((req: ApprovalRequest) => Promise<ApprovalAnswer>) | null = null;
  private approvalChain: Promise<unknown> = Promise.resolve();

  constructor(opts: SessionOptions) {
    this.root = opts.root;
    this.config = loadConfig();
    this.serious = !!opts.serious;
    this.sound = this.config.sound && !opts.mute;
    this.tts = this.config.tts && !opts.mute;
    this.yolo = !!opts.yolo;
    const asked = findTheme(opts.theme);
    setTheme(asked?.id ?? this.config.theme);
    if (opts.theme && !asked) queueMicrotask(() => this.bus.emit("notice", { text: `No theme called "${opts.theme}". ${themeList()}` }));
    for (const t of [...READ_ONLY_TOOLS, ...this.config.autoApprove]) this.alwaysAllow.add(t);

    if (opts.client) {
      this.client = opts.client;
    } else {
      try {
        // Keys not scoped to a workspace must name one on every request.
        const workspace = process.env.ANTHROPIC_WORKSPACE_ID ?? this.config.workspaceId;
        this.client = new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});
      } catch (err) {
        this.client = null;
        queueMicrotask(() => this.bus.emit("error", { message: describeError(err) }));
      }
    }

    if (this.client) {
      const approve = (req: ApprovalRequest) => this.approve(req);
      const make = (crew: "builder" | "planner" | "critic", tools?: string[]) =>
        new Agent({ crew, client: this.client!, config: this.config, root: this.root, bus: this.bus, approve, tools });
      this.crew = {
        builder: make("builder"),
        planner: make("planner", READ_ONLY_TOOLS),
        critic: make("critic", READ_ONLY_TOOLS),
      };
    }

    this.engine = new GameEngine(this.bus, loadProfile());
    this.narrator = new Narrator(this.bus, this.client, this.config, this.root);
    this.applyMode();
    this.wireSound();
    this.engine.startSession();
    if (this.sound && !this.serious) play("start");
    if (!opts.client && !hasCredentials()) {
      queueMicrotask(() =>
        this.bus.emit("notice", {
          text: "⚠ No Anthropic credentials found. Set ANTHROPIC_API_KEY (or run `ant auth login`) before handing the crew a job.",
        }),
      );
    }
  }

  get theme(): Theme {
    return theme();
  }

  /** Dress the whole session in another theme: crew, game, narrator and UI. Progress carries over. */
  switchTheme(next: Theme, persist = true): void {
    setTheme(next.id);
    this.engine.retheme();
    if (persist) saveTheme(next.id);
    this.bus.emit("theme", { id: next.id });
  }

  /** The UI registers how to ask the user. Requests are queued so prompts never overlap. */
  setApprovalHandler(fn: (req: ApprovalRequest) => Promise<ApprovalAnswer>): void {
    this.askUser = fn;
  }

  private approve(req: ApprovalRequest): Promise<boolean> {
    if (this.yolo || this.alwaysAllow.has(req.tool)) return Promise.resolve(true);
    const next = this.approvalChain.then(async () => {
      // An earlier "always" in the queue may have covered this one.
      if (this.alwaysAllow.has(req.tool)) return true;
      if (!this.askUser) return false;
      if (this.sound) play("gate");
      const answer = await this.askUser(req);
      if (answer === "always") this.alwaysAllow.add(req.tool);
      return answer !== "no";
    });
    this.approvalChain = next.catch(() => {});
    return next;
  }

  private applyMode(): void {
    this.engine.enabled = !this.serious;
    this.narrator.enabled = !this.serious && this.config.narrator;
  }

  private wireSound(): void {
    const sfx = (fn: () => void) => () => {
      if (this.sound && !this.serious) fn();
    };
    const b = this.bus;
    b.on("boss", ({ change }) =>
      sfx(() => {
        if (change === "spawn") play("fail");
        else if (change === "grow") play("grow");
        else if (change === "hit") play("hit");
        else if (change === "defeated") play("success");
      })(),
    );
    b.on("hack", sfx(() => play("hack")));
    b.on("rank_up", sfx(() => play("rankup")));
    b.on("error", sfx(() => play("fail")));
    b.on("turn_end", (t) => {
      if (t.crew === "builder" && t.stopReason === "end_turn") sfx(() => play("done"))();
    });
    b.on("narration", (n) => {
      if (this.tts && !this.serious) speak(n.text);
    });
  }

  /** Esc: stop whatever the crew is doing. */
  interrupt(): void {
    this.abort?.abort();
    stopSpeaking();
  }

  private async task(fn: (p: Crew, signal: AbortSignal) => Promise<unknown>): Promise<void> {
    if (!this.crew) {
      this.bus.emit("error", {
        message: "No API access. Set ANTHROPIC_API_KEY (or run `ant auth login`) and restart.",
      });
      return;
    }
    this.busy = true;
    this.abort = new AbortController();
    try {
      await fn(this.crew, this.abort.signal);
    } catch (err) {
      if (!this.abort.signal.aborted) this.bus.emit("error", { message: describeError(err) });
    } finally {
      if (this.abort.signal.aborted) this.bus.emit("notice", { text: "Interrupted." });
      this.abort = null;
      this.busy = false;
    }
  }

  /** Handle one line of input: a slash command or a job for the builder. */
  async submit(line: string): Promise<"quit" | void> {
    const text = line.trim();
    if (!text) return;
    if (!text.startsWith("/")) return this.task((p, s) => p.builder.run(text, s));

    const [raw, ...rest] = text.split(/\s+/);
    const arg = rest.join(" ");
    const say = (t: string) => this.bus.emit("notice", { text: t });
    const l = theme().lines;
    // Every theme's name for a command works in every theme: /quest in Netrunner is still a heist.
    const cmd = PLAN_COMMANDS.has(raw) ? "/heist" : ACHIEVEMENT_COMMANDS.has(raw) ? "/hacks" : raw;
    switch (cmd) {
      case "/quit":
      case "/exit":
        return "quit";
      case "/help":
        say(help());
        return;
      case "/heist":
        if (!arg) return say(`Usage: ${raw} <task>`);
        return this.task(async (p, s) => {
          await runHeist(p, this.bus, this.root, arg, s);
          if (!s.aborted) this.engine.award("full_crew");
        });
      case "/roast":
        return this.task((p, s) => runRoast(p, this.bus, this.root, s));
      case "/stats":
        say(this.stats());
        return;
      case "/hacks":
        say(this.hacks());
        return;
      case "/theme":
      case "/themes": {
        if (!arg) return say(themeList());
        const next = findTheme(arg);
        if (!next) return say(`No theme called "${arg}". ${themeList()}`);
        this.switchTheme(next);
        say(next.lines.themeSet);
        return;
      }
      case "/mute":
        this.sound = !this.sound;
        if (!this.sound) {
          this.tts = false;
          stopSpeaking();
        }
        say(this.sound ? l.soundOn : l.soundOff);
        return;
      case "/tts":
        this.tts = !this.tts;
        if (!this.tts) stopSpeaking();
        say(this.tts ? l.ttsOn : l.ttsOff);
        return;
      case "/serious":
        this.serious = !this.serious;
        this.applyMode();
        say(this.serious ? l.seriousOn : l.seriousOff);
        return;
      case "/clear":
        if (this.crew) Object.values(this.crew).forEach((a) => a.reset());
        say(l.cleared);
        return;
      default:
        say(`Unknown command ${cmd}. Try /help.`);
    }
  }

  private stats(): string {
    const t = theme();
    const p = this.engine.profile;
    const { rank, next } = progress(p.xp);
    const earned = Object.keys(p.hacks).length;
    return [
      `${rank.glyph} ${rank.name} · ${p.xp} ${t.words.xp}${next ? ` (${next.min - p.xp} to ${next.name})` : ""}`,
      `${cap(t.words.achievements)}: ${earned}/${allHacks().length} · Sessions: ${p.stats.sessions} · Day streak: ${streak(p.days)}`,
      `Tests fixed: ${p.stats.testsFixed} · ${cap(t.words.foes)} ${t.words.defeated}: ${p.stats.bossesDefeated} · ${cap(t.words.jobs)}: ${p.stats.tasks} · ${t.crew.critic.title} approvals: ${p.stats.reviewsPassed}`,
    ].join("\n");
  }

  private hacks(): string {
    const earned = this.engine.profile.hacks;
    return allHacks()
      .map((h) => `${earned[h.id] ? "✦" : "·"} ${h.title.padEnd(24)} ${h.description}  (+${h.reward})`)
      .join("\n");
  }
}

/** A best guess, for a friendly warning only: the SDK itself has the final say. */
function hasCredentials(): boolean {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE) return true;
  if (process.env.ANTHROPIC_FEDERATION_RULE_ID) return true;
  const configDir = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return fs.existsSync(path.join(configDir, "anthropic"));
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Each theme's names for the plan-build-review and achievements commands, plus the classics. */
const PLAN_COMMANDS = new Set(["/heist", "/council", ...Object.values(THEMES).map((t) => `/${t.words.plan}`)]);
const ACHIEVEMENT_COMMANDS = new Set(["/hacks", "/labours", "/achievements", ...Object.values(THEMES).map((t) => `/${t.words.achievements}`)]);

export function themeList(): string {
  const current = theme().id;
  const rows = Object.values(THEMES).map((t) => `${t.id === current ? "▸" : " "} ${t.id.padEnd(10)} ${t.tagline}  (also: ${t.aliases.join(", ")})`);
  return `Themes. Switch with /theme <name>; your progress carries over.\n${rows.join("\n")}`;
}

function help(): string {
  const t = theme();
  const { builder, planner, critic } = t.crew;
  return fill(
    `Type a {job} and {builder} takes it. Commands:
  {plan}{planner} plans, {builder} builds, {critic} reviews
  /roast           {critic} reviews your uncommitted changes
  /stats           your rank, {xp} and record
  {achievements}{Achievements} earned and still to earn
  /theme [name]    list the themes, or switch to one
  /mute            toggle sound      /tts      toggle spoken narration
  /serious         toggle the fun    /clear    wipe the conversation
  /quit            {quit}
Esc interrupts the crew mid-job.`,
    {
      job: t.words.job,
      builder: builder.title,
      planner: planner.title,
      critic: critic.title,
      xp: t.words.xp,
      plan: `/${t.words.plan} <task>`.padEnd(17),
      achievements: `/${t.words.achievements}`.padEnd(17),
      Achievements: cap(t.words.achievements),
      quit: t.lines.quit,
    },
  );
}
