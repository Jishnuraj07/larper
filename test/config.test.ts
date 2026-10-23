import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig, saveTheme } from "../src/config.js";
import { emptyProfile, loadProfile, localDay, saveProfile } from "../src/game/profile.js";

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "larper-config-"));
  process.env.LARPER_HOME = home;
});
afterEach(() => {
  delete process.env.LARPER_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("writes the defaults on first run", () => {
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
    expect(JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"))).toEqual(DEFAULT_CONFIG);
  });

  it("merges a partial user config over the defaults", () => {
    fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ sound: false, models: { critic: "claude-opus-5-5" } }));
    const c = loadConfig();
    expect(c.sound).toBe(false);
    expect(c.models.critic).toBe("claude-opus-5-5");
    expect(c.models.builder).toBe(DEFAULT_CONFIG.models.builder);
    expect(c.effort).toEqual(DEFAULT_CONFIG.effort);
  });

  it("carries over models and effort set under Ambrosia's crew names", () => {
    fs.writeFileSync(
      path.join(home, "config.json"),
      JSON.stringify({
        models: { hephaestus: "claude-sonnet-5-5", momus: "claude-haiku-4-5", critic: "claude-opus-5-5", radio: "claude-sonnet-5-5" },
        effort: { athena: "max", fabricator: "low" },
      }),
    );
    const c = loadConfig();
    expect(c.models.builder).toBe("claude-sonnet-5-5");
    expect(c.models.critic).toBe("claude-opus-5-5"); // the current key wins over the legacy one
    expect(c.models.narrator).toBe("claude-sonnet-5-5");
    expect(c.effort.planner).toBe("max");
    expect(c.effort.builder).toBe("low");
    expect(Object.keys(c.models).sort()).toEqual(["builder", "critic", "narrator", "planner"]);
    expect(c.theme).toBe("netrunner");
  });

  it("reads the theme by id or alias, and saveTheme keeps the rest of the file", () => {
    fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ theme: "LinkedIn", sound: false }));
    expect(loadConfig().theme).toBe("hustle");
    saveTheme("dungeon");
    const saved = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"));
    expect(saved).toEqual({ theme: "dungeon", sound: false });
    fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ theme: "vaporwave" }));
    expect(loadConfig().theme).toBe("netrunner");
  });

  it("survives a corrupt config file", () => {
    fs.writeFileSync(path.join(home, "config.json"), "{ not json");
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
  });
});

describe("profile persistence", () => {
  it("round-trips through disk", () => {
    const p = emptyProfile();
    p.xp = 123;
    p.hacks.first_blood = "2026-10-18T00:00:00.000Z";
    p.stats.failCounts["a test"] = 2;
    saveProfile(p);
    expect(loadProfile()).toEqual(p);
    expect(fs.existsSync(path.join(home, "profile.json.tmp"))).toBe(false);
  });

  it("starts fresh when the file is missing or corrupt", () => {
    expect(loadProfile()).toEqual(emptyProfile());
    fs.writeFileSync(path.join(home, "profile.json"), "garbage");
    expect(loadProfile()).toEqual(emptyProfile());
  });

  it("fills in stats added in newer versions", () => {
    fs.writeFileSync(path.join(home, "profile.json"), JSON.stringify({ xp: 50, stats: { sessions: 3 } }));
    const p = loadProfile();
    expect(p.xp).toBe(50);
    expect(p.stats.sessions).toBe(3);
    expect(p.stats.failCounts).toEqual({});
  });

  it("keeps achievements earned as labours under the old Greek ids", () => {
    const old = { xp: 300, labours: { first_blood: "2026-10-01T00:00:00.000Z", golden_fleece: "2026-10-02T00:00:00.000Z" } };
    fs.writeFileSync(path.join(home, "profile.json"), JSON.stringify(old));
    const p = loadProfile();
    expect(p.hacks).toEqual({ first_blood: "2026-10-01T00:00:00.000Z", cracked_ice: "2026-10-02T00:00:00.000Z" });
    expect(p).not.toHaveProperty("labours");
  });

  it("localDay uses the local calendar date", () => {
    const d = new Date(2026, 9, 18, 23, 30); // 18 Oct, 23:30 local
    expect(localDay(d)).toBe("2026-10-18");
  });
});
