import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type Anthropic from "@anthropic-ai/sdk";
import type { CrewName } from "../config.js";
import { THEMES } from "../theme/index.js";

type ScriptedMessage = { stop_reason: string; content: Array<Record<string, unknown>> };

/**
 * The demo session used by the smoke tests: the builder finds a failing test in
 * math.mjs, fixes `add`, and reruns; the critic approves. No API key needed.
 */
export function demoScripts(testCommand = "node --test"): Partial<Record<CrewName, ScriptedMessage[]>> {
  return {
    builder: [
      { stop_reason: "tool_use", content: [{ type: "text", text: "Let's see what's broken." }, { type: "tool_use", id: "h1", name: "run_tests", input: { command: testCommand } }] },
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "h2", name: "read_file", input: { path: "math.mjs" } }] },
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "h3", name: "edit_file", input: { path: "math.mjs", old_string: "a - b", new_string: "a + b" } }] },
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "h4", name: "run_tests", input: { command: testCommand } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Fixed: `add` subtracted instead of adding. All **3 tests** pass. Done and dusted." }] },
    ],
    critic: [
      { stop_reason: "end_turn", content: [{ type: "text", text: "A one-character fix. Someone alert the newsfeeds.\n\nNo real findings.\n\nVERDICT: APPROVED" }] },
    ],
  };
}

/** Which crew member a request is for, from the persona line that opens its system prompt, in any theme. */
function crewOf(system: unknown): CrewName | null {
  const text = typeof system === "string" ? system : "";
  for (const t of Object.values(THEMES)) {
    for (const [crew, skin] of Object.entries(t.crew)) if (text.startsWith(`You are ${skin.title},`)) return crew as CrewName;
  }
  return null;
}

/**
 * A stand-in for the SDK client that replays scripted replies per crew member.
 * Only the calls Larper makes are implemented: beta streaming for the crew and
 * messages.create for the narrator.
 */
export function createScriptedClient(scripts: Partial<Record<CrewName, ScriptedMessage[]>>, delayMs = 150): Anthropic {
  const fallback = (crew: CrewName | null): ScriptedMessage => ({
    stop_reason: "end_turn",
    content: [{ type: "text", text: `(${crew ?? "unknown"} has no more scripted lines)` }],
  });
  const client = {
    beta: {
      messages: {
        stream(params: { system?: unknown }) {
          const crew = crewOf(params.system);
          const msg = (crew && scripts[crew]?.shift()) || fallback(crew);
          const on: Record<string, (d: string) => void> = {};
          return {
            on(name: string, fn: (d: string) => void) {
              on[name] = fn;
              return this;
            },
            async finalMessage() {
              await new Promise((r) => setTimeout(r, delayMs));
              on.thinking?.("Tracing where the numbers go wrong…");
              for (const b of msg.content) if (b.type === "text") on.text?.(String(b.text));
              return { usage: { input_tokens: 1, output_tokens: 1 }, stop_details: null, ...msg };
            },
          };
        },
      },
    },
    messages: {
      async create() {
        return { stop_reason: "end_turn", content: [{ type: "text", text: "Caught it all, and everyone is listening." }] };
      },
    },
  };
  return client as unknown as Anthropic;
}

/** A tiny project with one bug (`add` subtracts) and three tests, two of them failing. */
export function createDemoProject(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "math.mjs"), "export const add = (a, b) => a - b;\n");
  fs.writeFileSync(
    path.join(dir, "math.test.mjs"),
    `import test from "node:test";
import assert from "node:assert";
import { add } from "./math.mjs";
test("adds", () => assert.equal(add(2, 2), 4));
test("adds negatives", () => assert.equal(add(-1, -1), -2));
test("adds zero", () => assert.equal(add(0, 0), 0));
`,
  );
  execSync("git init -q && git add . && git -c user.email=demo@larper -c user.name=demo commit -qm init", {
    cwd: dir,
    stdio: "ignore",
  });
}
