import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Bus } from "../src/events.js";
import { currentDiff, runHeist, runRoast, type Crew } from "../src/agent/council.js";
import type { RunResult } from "../src/agent/loop.js";
import { setTheme } from "../src/theme/index.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "larper-council-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** A crew member that replies from a script and records what it was told. */
function fakeCrew(replies: string[]) {
  const prompts: string[] = [];
  return {
    prompts,
    async run(prompt: string): Promise<RunResult> {
      prompts.push(prompt);
      return { text: replies.shift() ?? "", stopReason: "end_turn" };
    },
    reset() {},
  };
}

function crew(planner: string[], builder: string[], critic: string[]) {
  const members = { planner: fakeCrew(planner), builder: fakeCrew(builder), critic: fakeCrew(critic) };
  return { members, p: members as unknown as Crew };
}

function listen(bus: Bus) {
  const reviews: boolean[] = [];
  const notices: string[] = [];
  bus.on("review", (r) => reviews.push(r.approved));
  bus.on("notice", (n) => notices.push(n.text));
  return { reviews, notices };
}

describe("runHeist", () => {
  it("passes the planner's plan to the builder and stops when the critic approves", async () => {
    const bus = new Bus();
    const { reviews } = listen(bus);
    const { members, p } = crew(["1. Edit cli.ts"], ["Added the flag."], ["Adequate.\nVERDICT: APPROVED"]);

    await runHeist(p, bus, root, "add a --version flag");

    expect(members.planner.prompts[0]).toContain("add a --version flag");
    expect(members.builder.prompts).toHaveLength(1);
    expect(members.builder.prompts[0]).toContain("1. Edit cli.ts");
    expect(members.critic.prompts[0]).toContain("Added the flag.");
    expect(members.critic.prompts[0]).toContain("<diff>");
    expect(reviews).toEqual([true]);
  });

  it("sends the builder back once when the critic wants changes", async () => {
    const bus = new Bus();
    const { reviews, notices } = listen(bus);
    const { members, p } = crew(["plan"], ["first try", "fixed it"], ["Off-by-one.\nVERDICT: REVISE", "Fine.\nVERDICT: APPROVED"]);

    await runHeist(p, bus, root, "task");

    expect(members.builder.prompts).toHaveLength(2);
    expect(members.builder.prompts[1]).toContain("Off-by-one.");
    expect(reviews).toEqual([false, true]);
    expect(notices).toContain("Black ICE found a hole. Back to the workbench.");
  });

  it("speaks in the current theme", async () => {
    setTheme("hustle");
    try {
      const bus = new Bus();
      const { notices } = listen(bus);
      const { members, p } = crew(["plan"], ["first try", "fixed it"], ["VERDICT: REVISE", "VERDICT: APPROVED"]);
      await runHeist(p, bus, root, "task");
      expect(notices[0]).toBe("Quick sync, everyone. The sprint kicks off.");
      expect(notices).toContain("The VP of Synergy has some feedback. Back to the backlog.");
      expect(members.builder.prompts[0]).toContain("Thought Leader's plan");
    } finally {
      setTheme("netrunner");
    }
  });

  it("allows only one revision round", async () => {
    const bus = new Bus();
    const { reviews } = listen(bus);
    const { members, p } = crew(["plan"], ["a", "b", "c"], ["VERDICT: REVISE", "VERDICT: REVISE", "VERDICT: REVISE"]);
    await runHeist(p, bus, root, "task");
    expect(members.builder.prompts).toHaveLength(2);
    expect(reviews).toEqual([false, false]);
  });

  it("stops if a crew member's turn errors", async () => {
    const bus = new Bus();
    const { members, p } = crew(["plan"], [], []);
    members.planner.run = async () => ({ text: "", stopReason: "error" });
    await runHeist(p, bus, root, "task");
    expect(members.builder.prompts).toEqual([]);
  });

  it("stops when interrupted", async () => {
    const bus = new Bus();
    const ac = new AbortController();
    const { members, p } = crew(["plan"], ["built"], ["VERDICT: APPROVED"]);
    const run = members.planner.run.bind(members.planner);
    members.planner.run = async (prompt: string) => {
      ac.abort();
      return run(prompt);
    };
    await runHeist(p, bus, root, "task", ac.signal);
    expect(members.builder.prompts).toEqual([]);
  });
});

describe("runRoast", () => {
  it("asks the critic about the diff and reports the verdict", async () => {
    const bus = new Bus();
    const { reviews } = listen(bus);
    const { members, p } = crew([], [], ["Pathetic.\nVERDICT: REVISE"]);
    await runRoast(p, bus, root);
    expect(members.critic.prompts[0]).toMatch(/Roast the uncommitted changes/);
    expect(reviews).toEqual([false]);
  });
});

describe("currentDiff", () => {
  it("explains when the project is not a git repository", async () => {
    expect(await currentDiff(root)).toMatch(/not a git repository/);
  });
});
