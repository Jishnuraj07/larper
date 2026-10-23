import { describe, expect, it } from "vitest";
import { Bus, type EventMap } from "../src/events.js";
import { GameEngine, XP } from "../src/game/engine.js";
import { emptyProfile, streak } from "../src/game/profile.js";
import { progress, rankFor } from "../src/game/ranks.js";

function setup(now = new Date("2026-10-18T14:00:00")) {
  const bus = new Bus();
  const engine = new GameEngine(bus, emptyProfile(), { persist: false, now: () => now });
  const seen: Array<{ name: string; payload: unknown }> = [];
  for (const name of ["xp", "hack", "boss", "rank_up"] as const) {
    bus.on(name, (payload) => seen.push({ name, payload }));
  }
  const tests = (failed: number, passed: number, failing: string[] = []) =>
    bus.emit("test_result", { failed, passed, failing, parsed: true });
  const hacks = () => seen.filter((s) => s.name === "hack").map((s) => (s.payload as EventMap["hack"]).id);
  return { bus, engine, seen, tests, hacks };
}

describe("ranks", () => {
  it("maps xp to ranks and progress", () => {
    expect(rankFor(0).name).toBe("Script Kiddie");
    expect(rankFor(100).name).toBe("Runner");
    expect(rankFor(99_999).name).toBe("Legend");
    expect(progress(250).fraction).toBeCloseTo(0.5);
    expect(progress(5000).next).toBeNull();
  });
});

describe("GameEngine boss fights", () => {
  it("spawns, takes hits and falls", () => {
    const { engine, tests, hacks } = setup();
    tests(3, 5, ["a", "b", "c"]);
    expect(engine.boss).toMatchObject({ name: "Daemon", hp: 3, maxHp: 3 });

    tests(1, 7, ["c"]);
    expect(engine.boss?.hp).toBe(1);
    expect(hacks()).toContain("first_blood");

    tests(0, 8);
    expect(engine.boss).toBeNull();
    expect(hacks()).toContain("daemon_killer");
    expect(hacks()).not.toContain("fork_bomb");
    expect(engine.profile.stats.testsFixed).toBe(3);
  });

  it("awards Fork Bomb Survivor when the threat spawned three new failures", () => {
    const { engine, tests, hacks } = setup();
    tests(1, 0, ["a"]);
    tests(4, 0, ["a", "b", "c", "d"]);
    expect(engine.boss).toMatchObject({ name: "Worm", hp: 4, maxHp: 4 });
    tests(0, 4);
    expect(hacks()).toContain("fork_bomb");
  });

  it("charges for regressions of tests fixed this session", () => {
    const { engine, tests, seen } = setup();
    tests(2, 0, ["a", "b"]);
    tests(1, 1, ["b"]); // a fixed
    const before = engine.profile.xp;
    tests(2, 0, ["a", "b"]); // a broke again
    expect(engine.profile.xp).toBe(before + XP.regression);
    expect(seen.some((s) => s.name === "xp" && (s.payload as EventMap["xp"]).reason === "regression")).toBe(true);
  });

  it("awards Infinite Loop after five failing runs of one test", () => {
    const { tests, hacks } = setup();
    for (let i = 0; i < 5; i++) tests(1, 0, ["stubborn"]);
    expect(hacks()).toContain("infinite_loop");
  });
});

describe("GameEngine other hacks", () => {
  it("awards Bricked for an approved risky command that fails", () => {
    const { bus, hacks } = setup();
    bus.emit("shell_result", { crew: "builder", command: "rm -rf x", exitCode: 1, risky: true, approved: true });
    expect(hacks()).toEqual(["bricked"]);
  });

  it("awards Firewall after three denials", () => {
    const { bus, hacks } = setup();
    for (let i = 0; i < 3; i++) bus.emit("approval", { crew: "builder", tool: "shell", summary: "x", approved: false, risky: false });
    expect(hacks()).toEqual(["firewall"]);
  });

  it("awards each hack only once and ranks up", () => {
    const { bus, engine, seen, hacks } = setup();
    for (let i = 0; i < 3; i++) bus.emit("review", { approved: true });
    expect(hacks()).toEqual(["cracked_ice"]);
    expect(engine.profile.xp).toBe(3 * XP.review + 50);
    expect(seen.some((s) => s.name === "rank_up")).toBe(true);
  });

  it("does nothing when disabled (serious mode)", () => {
    const { engine, tests, seen } = setup();
    engine.enabled = false;
    tests(3, 0, ["a"]);
    engine.award("night_shift");
    expect(seen).toEqual([]);
    expect(engine.boss).toBeNull();
  });

  it("counts day streaks and night sessions", () => {
    const { engine, hacks } = setup(new Date("2026-10-18T02:30:00"));
    engine.profile.days = ["2026-10-16", "2026-10-17"];
    engine.startSession();
    expect(hacks()).toEqual(expect.arrayContaining(["night_shift", "uptime"]));
    expect(streak(["2026-10-10", "2026-10-12", "2026-10-13"])).toBe(2);
  });
});
