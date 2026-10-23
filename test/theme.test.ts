import { afterEach, describe, expect, it } from "vitest";
import { THEMES, fill, findTheme, setTheme, theme } from "../src/theme/index.js";
import { HACK_IDS, REWARDS, allHacks, hack } from "../src/game/hacks.js";
import { RANK_MINS, progress, threatFor } from "../src/game/ranks.js";
import { personas, systemPrompt } from "../src/agent/personas.js";

afterEach(() => setTheme("netrunner"));

const themes = Object.values(THEMES);

describe("themes", () => {
  it.each(themes.map((t) => [t.id, t] as const))("%s is complete", (_id, t) => {
    expect(t.ranks).toHaveLength(RANK_MINS.length);
    expect(t.threats).toHaveLength(4);
    expect(Object.keys(t.hacks).sort()).toEqual([...HACK_IDS].sort());
    expect(Object.keys(t.crew).sort()).toEqual(["builder", "critic", "narrator", "planner"]);
    for (const kind of Object.keys(THEMES.netrunner.narration)) expect(t.narration[kind as keyof typeof t.narration].length).toBeGreaterThan(0);
    for (const [key, line] of Object.entries(t.lines)) expect(line, key).toBeTruthy();
  });

  it("uses only placeholders that get filled", () => {
    const known = new Set(["foe", "n", "s", "rank", "tool", "boss", "hp", "title"]);
    for (const t of themes) {
      for (const line of [...Object.values(t.lines), ...Object.values(t.narration).flat()]) {
        for (const [, name] of line.matchAll(/\{(\w+)\}/g)) expect(known.has(name), `${t.id}: {${name}} in "${line}"`).toBe(true);
      }
    }
  });

  it("gives each theme distinct names and commands", () => {
    expect(new Set(themes.map((t) => t.words.plan)).size).toBe(themes.length);
    expect(new Set(themes.map((t) => t.words.achievements)).size).toBe(themes.length);
    // The scripted demo client tells the crew apart by title, across every theme.
    const titles = themes.flatMap((t) => Object.values(t.crew).map((c) => c.title));
    expect(new Set(titles).size).toBe(titles.length);
    const aliases = themes.flatMap((t) => [t.id, ...t.aliases]);
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it("finds themes by id, name or alias", () => {
    expect(findTheme("hustle")?.id).toBe("hustle");
    expect(findTheme(" LinkedIn ")?.id).toBe("hustle");
    expect(findTheme("Greek")?.id).toBe("olympus");
    expect(findTheme("dnd")?.id).toBe("dungeon");
    expect(findTheme("Starship")?.id).toBe("starship");
    expect(findTheme("vaporwave")).toBeUndefined();
    expect(findTheme(undefined)).toBeUndefined();
  });

  it("fills templates and pluralises {s} against {n}", () => {
    expect(fill("A {foe} appears! {n} failing test{s}.", { foe: "Bug", n: 1 })).toBe("A Bug appears! 1 failing test.");
    expect(fill("A {foe} appears! {n} failing test{s}.", { foe: "Bug", n: 3 })).toBe("A Bug appears! 3 failing tests.");
    expect(fill("{missing}!")).toBe("!");
  });

  it("dresses ranks, foes, achievements and the crew in the current theme, keeping the rules", () => {
    setTheme("olympus");
    expect(progress(150).rank.name).toBe("Hero");
    expect(threatFor(7)).toBe("Hydra");
    expect(hack("cracked_ice")).toEqual({ id: "cracked_ice", title: "Golden Fleece", description: "Win Momus's approval", reward: 50 });
    expect(personas().builder.title).toBe("Hephaestus");

    setTheme("hustle");
    expect(theme().name).toBe("Hustle");
    expect(progress(150).rank.name).toBe("Associate");
    expect(threatFor(7)).toBe("Reorg");
    expect(allHacks().map((h) => h.reward)).toEqual(Object.values(REWARDS));
    expect(hack("cracked_ice").reward).toBe(50);
  });

  it("writes every system prompt in the theme's voice around the same instructions", () => {
    for (const t of themes) {
      setTheme(t.id);
      for (const crew of ["builder", "planner", "critic", "narrator"] as const) {
        const prompt = systemPrompt(crew, "/project");
        expect(prompt.startsWith(`You are ${t.crew[crew].title},`)).toBe(true);
        expect(prompt).toContain("Project root: /project");
      }
      expect(systemPrompt("critic", "/p")).toMatch(/VERDICT: APPROVED/);
      expect(systemPrompt("planner", "/p")).toContain(`${t.crew.builder.title} will build what you plan, and ${t.crew.critic.title} will review it.`);
    }
  });
});
