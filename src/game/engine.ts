import type { Boss, Bus, TestResult } from "../events.js";
import { hack, type HackId } from "./hacks.js";
import { localDay, saveProfile, streak, type Profile } from "./profile.js";
import { rankFor, threatFor, tierFor } from "./ranks.js";
import { theme } from "../theme/index.js";

export const XP = {
  processKilled: 10,
  bossDefeated: 25,
  greenRun: 2,
  regression: -5,
  task: 5,
  review: 20,
};

export interface EngineOptions {
  /** Persist after every change. Off in tests. */
  persist?: boolean;
  now?: () => Date;
}

/**
 * Turns harness events into cred, ranks, achievements and foes. It only
 * listens to the bus, so muting the fun never touches the agent itself.
 */
export class GameEngine {
  boss: Boss | null = null;
  enabled = true;
  private failing = new Set<string>();
  private fixedThisSession = new Set<string>();
  private denials = 0;
  private unsubscribe: Array<() => void> = [];
  private persist: boolean;
  private now: () => Date;

  constructor(
    private bus: Bus,
    readonly profile: Profile,
    opts: EngineOptions = {},
  ) {
    this.persist = opts.persist ?? true;
    this.now = opts.now ?? (() => new Date());
    this.unsubscribe = [
      bus.on("test_result", (r) => this.enabled && this.onTests(r)),
      bus.on("shell_result", (r) => {
        if (this.enabled && r.risky && r.approved && r.exitCode !== 0) this.award("bricked");
      }),
      bus.on("approval", (a) => {
        if (!this.enabled || a.approved) return;
        if (++this.denials === 3) this.award("firewall");
      }),
      bus.on("turn_end", (t) => {
        if (!this.enabled || t.crew !== "builder" || t.stopReason !== "end_turn") return;
        this.profile.stats.tasks++;
        this.gain(XP.task, `${theme().words.job} complete`);
        if (this.profile.stats.tasks >= 10) this.award("gig_economy");
      }),
      bus.on("review", (r) => {
        if (!this.enabled || !r.approved) return;
        this.profile.stats.reviewsPassed++;
        this.gain(XP.review, `${theme().crew.critic.title} approves`);
        this.award("cracked_ice");
      }),
    ];
  }

  /** Call once per session: counts the session and checks time-based hacks. */
  startSession(): void {
    const now = this.now();
    const today = localDay(now);
    this.profile.stats.sessions++;
    if (this.profile.days[this.profile.days.length - 1] !== today) {
      this.profile.days = [...this.profile.days, today].slice(-60);
    }
    if (now.getHours() < 5) this.award("night_shift");
    if (streak(this.profile.days) >= 3) this.award("uptime");
    this.save();
  }

  /** After a theme switch: give the foe on the field its new name. */
  retheme(): void {
    if (this.boss) this.boss.name = threatFor(this.boss.maxHp);
  }

  dispose(): void {
    this.unsubscribe.forEach((u) => u());
  }

  award(id: HackId): void {
    if (!this.enabled || this.profile.hacks[id]) return;
    const earned = hack(id);
    this.profile.hacks[id] = this.now().toISOString();
    this.bus.emit("hack", earned);
    this.gain(earned.reward, earned.title);
  }

  gain(amount: number, reason: string): void {
    if (!amount) return;
    const before = rankFor(this.profile.xp);
    this.profile.xp = Math.max(0, this.profile.xp + amount);
    this.bus.emit("xp", { amount, reason, total: this.profile.xp });
    const after = rankFor(this.profile.xp);
    if (after.min > before.min) this.bus.emit("rank_up", { rank: after.name });
    this.save();
  }

  private onTests(r: TestResult): void {
    const nowFailing = new Set(r.failing);

    // Infinite Loop: the same named test failing run after run.
    for (const name of nowFailing) {
      const n = (this.profile.stats.failCounts[name] ?? 0) + 1;
      this.profile.stats.failCounts[name] = n;
      if (n >= 5) this.award("infinite_loop");
    }

    // A test we fixed earlier is failing again.
    const regressions = [...nowFailing].filter((n) => this.fixedThisSession.has(n));
    for (const name of regressions) this.fixedThisSession.delete(name);
    if (regressions.length) this.gain(XP.regression * regressions.length, "regression");

    for (const name of this.failing) if (!nowFailing.has(name)) this.fixedThisSession.add(name);
    this.failing = nowFailing;

    const boss = this.boss;
    if (!boss) {
      if (r.failed > 0) {
        this.boss = { name: threatFor(r.failed), tier: tierFor(r.failed), hp: r.failed, maxHp: r.failed, startHp: r.failed };
        this.bus.emit("boss", { boss: this.boss, change: "spawn" });
      } else if (r.passed > 0) {
        this.gain(XP.greenRun, "all green");
      }
      this.save();
      return;
    }

    if (r.failed === 0) {
      const killed = boss.hp;
      this.profile.stats.testsFixed += killed;
      this.profile.stats.bossesDefeated++;
      this.gain(XP.processKilled * killed + XP.bossDefeated, `${boss.name} ${theme().words.defeated}`);
      this.award("first_blood");
      this.award("daemon_killer");
      if (boss.maxHp >= boss.startHp + 3) this.award("fork_bomb");
      this.boss = null;
      this.bus.emit("boss", { boss: { ...boss, hp: 0 }, change: "defeated" });
    } else if (r.failed < boss.hp) {
      const killed = boss.hp - r.failed;
      boss.hp = r.failed;
      this.profile.stats.testsFixed += killed;
      this.gain(XP.processKilled * killed, `${killed} test${killed > 1 ? "s" : ""} fixed`);
      this.award("first_blood");
      this.bus.emit("boss", { boss: { ...boss }, change: "hit" });
    } else if (r.failed > boss.hp) {
      boss.hp = r.failed;
      boss.maxHp = Math.max(boss.maxHp, r.failed);
      boss.name = threatFor(boss.maxHp);
      boss.tier = tierFor(boss.maxHp);
      this.bus.emit("boss", { boss: { ...boss }, change: "grow" });
    } else {
      this.bus.emit("boss", { boss: { ...boss }, change: "none" });
    }
    this.save();
  }

  private save(): void {
    if (this.persist) saveProfile(this.profile);
  }
}
