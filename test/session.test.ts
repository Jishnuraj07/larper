import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ApprovalRequest } from "../src/agent/tools.js";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "larper-session-"));
process.env.LARPER_HOME = home;
// The SDK needs some credential to construct a client; no request is ever sent.
process.env.ANTHROPIC_API_KEY ??= "sk-ant-test";
const { Session } = await import("../src/session.js");

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

function make(opts: { yolo?: boolean; serious?: boolean; theme?: string } = {}) {
  const session = new Session({ root: home, mute: true, ...opts });
  const notices: string[] = [];
  session.bus.on("notice", (n) => notices.push(n.text));
  return { session, notices };
}

const req = (tool: string): ApprovalRequest => ({ crew: "builder", tool, summary: "x", detail: "x", risky: false });
const approve = (s: unknown, r: ApprovalRequest) => (s as { approve(r: ApprovalRequest): Promise<boolean> }).approve(r);

beforeEach(() => {
  fs.rmSync(path.join(home, "profile.json"), { force: true });
  fs.rmSync(path.join(home, "config.json"), { force: true });
});

describe("Session commands", () => {
  it("/quit and /exit end the session", async () => {
    const { session } = make();
    expect(await session.submit("/quit")).toBe("quit");
    expect(await session.submit("/exit")).toBe("quit");
  });

  it("/help, /stats and /hacks print to the transcript", async () => {
    const { session, notices } = make();
    await session.submit("/help");
    await session.submit("/stats");
    await session.submit("/hacks");
    expect(notices[0]).toContain("/heist <task>");
    expect(notices[1]).toMatch(/^💾 Script Kiddie · 0 cred \(100 to Runner\)/);
    expect(notices[2].split("\n")).toHaveLength(11);
  });

  it("/mute, /tts and /serious toggle modes", async () => {
    const { session } = make();
    expect(session.sound).toBe(false); // started muted
    await session.submit("/mute");
    expect(session.sound).toBe(true);
    await session.submit("/tts");
    expect(session.tts).toBe(true);
    await session.submit("/mute");
    expect([session.sound, session.tts]).toEqual([false, false]);

    await session.submit("/serious");
    expect(session.serious).toBe(true);
    expect(session.engine.enabled).toBe(false);
    await session.submit("/serious");
    expect(session.engine.enabled).toBe(true);
  });

  it("rejects unknown commands and usage errors", async () => {
    const { session, notices } = make();
    await session.submit("/teleport");
    await session.submit("/heist");
    await session.submit("/council");
    expect(notices).toEqual(["Unknown command /teleport. Try /help.", "Usage: /heist <task>", "Usage: /council <task>"]);
  });

  it("ignores blank input", async () => {
    const { session, notices } = make();
    expect(await session.submit("   ")).toBeUndefined();
    expect(notices).toEqual([]);
  });

  it("counts the session in the saved profile", () => {
    const { session } = make();
    expect(session.engine.profile.stats.sessions).toBe(1);
    const saved = JSON.parse(fs.readFileSync(path.join(home, "profile.json"), "utf8"));
    expect(saved.stats.sessions).toBe(1);
  });
});

describe("Session approvals", () => {
  it("allows read-only tools without asking", async () => {
    const { session } = make();
    let asked = 0;
    session.setApprovalHandler(async () => {
      asked++;
      return "no";
    });
    expect(await approve(session, req("read_file"))).toBe(true);
    expect(await approve(session, req("grep"))).toBe(true);
    expect(asked).toBe(0);
  });

  it("asks one at a time, and 'always' covers later requests for that tool", async () => {
    const { session } = make();
    const seen: string[] = [];
    let open = 0;
    let maxOpen = 0;
    session.setApprovalHandler(async (r) => {
      seen.push(r.tool);
      maxOpen = Math.max(maxOpen, ++open);
      await new Promise((res) => setTimeout(res, 10));
      open--;
      return r.tool === "shell" ? "always" : "no";
    });
    const results = await Promise.all([
      approve(session, req("shell")),
      approve(session, req("shell")),
      approve(session, req("write_file")),
      approve(session, req("shell")),
    ]);
    expect(results).toEqual([true, true, false, true]);
    expect(seen).toEqual(["shell", "write_file"]);
    expect(maxOpen).toBe(1);
  });

  it("declines when no UI is attached, and --yolo approves everything", async () => {
    expect(await approve(make().session, req("shell"))).toBe(false);
    expect(await approve(make({ yolo: true }).session, req("shell"))).toBe(true);
  });
});

describe("Session themes", () => {
  it("/theme lists the themes and marks the current one", async () => {
    const { session, notices } = make();
    await session.submit("/theme");
    expect(notices[0]).toMatch(/▸ netrunner/);
    for (const id of ["olympus", "dungeon", "starship", "hustle"]) expect(notices[0]).toContain(id);
  });

  it("switches by alias, speaks the new theme, and remembers it", async () => {
    const { session, notices } = make();
    const seen: string[] = [];
    session.bus.on("theme", (t) => seen.push(t.id));
    await session.submit("/theme linkedin");
    expect(seen).toEqual(["hustle"]);
    expect(notices[0]).toBe("Hustle mode on. Thrilled to be here.");
    await session.submit("/help");
    expect(notices[1]).toContain("/sprint <task>");
    expect(notices[1]).toContain("Thought Leader plans, 10x Engineer builds, VP of Synergy reviews");
    await session.submit("/stats");
    expect(notices[2]).toMatch(/^☕ Intern · 0 clout \(100 to Associate\)/);
    expect(JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8")).theme).toBe("hustle");
    expect(make().session.theme.id).toBe("hustle");
  });

  it("takes every theme's command names in any theme", async () => {
    const { session, notices } = make({ theme: "olympus" });
    await session.submit("/quest");
    await session.submit("/sprint");
    await session.submit("/badges");
    expect(notices.slice(0, 2)).toEqual(["Usage: /quest <task>", "Usage: /sprint <task>"]);
    expect(notices[2]).toContain("Golden Fleece");
  });

  it("renames the foe on the field when the theme changes", async () => {
    const { session } = make({ theme: "netrunner" });
    session.bus.emit("test_result", { passed: 0, failed: 2, failing: ["a", "b"], parsed: true });
    expect(session.engine.boss?.name).toBe("Daemon");
    await session.submit("/theme dungeon");
    expect(session.engine.boss?.name).toBe("Goblin");
  });

  it("warns about an unknown theme and keeps the current one", async () => {
    const { session, notices } = make();
    await session.submit("/theme vaporwave");
    expect(notices[0]).toMatch(/^No theme called "vaporwave"/);
    expect(session.theme.id).toBe("netrunner");
  });
});
