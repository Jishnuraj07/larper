import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Bus, type EventMap } from "../src/events.js";
import { findTool, READ_ONLY_TOOLS, runShell, toolParams, type ApprovalRequest, type ToolContext } from "../src/agent/tools.js";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "larper-tools-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function write(rel: string, text: string) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

let bus: Bus;
let asked: ApprovalRequest[];
let answer: boolean;
let events: Array<{ name: string; payload: unknown }>;

beforeEach(() => {
  bus = new Bus();
  asked = [];
  answer = true;
  events = [];
  for (const n of ["edit", "approval", "test_result", "shell_result"] as const) bus.on(n, (p) => events.push({ name: n, payload: p }));
});

function ctx(): ToolContext {
  return {
    root,
    crew: "builder",
    bus,
    approve: async (req) => {
      asked.push(req);
      return answer;
    },
  };
}

/** Run a tool by name with schema validation, the way the agent loop does. */
async function run(name: string, input: unknown): Promise<string> {
  const tool = findTool(name)!;
  return tool.run(tool.schema.parse(input) as never, ctx());
}

describe("tool definitions", () => {
  it("emit valid JSON schemas with eager input streaming", () => {
    const params = toolParams();
    expect(params.map((p) => p.name)).toEqual(["read_file", "write_file", "edit_file", "glob", "grep", "shell", "run_tests"]);
    for (const p of params) {
      expect(p.input_schema.type).toBe("object");
      expect(p.eager_input_streaming).toBe(true);
    }
    expect(params.find((p) => p.name === "edit_file")!.input_schema.required).toEqual(["path", "old_string", "new_string"]);
  });

  it("can be restricted to a subset", () => {
    expect(toolParams(READ_ONLY_TOOLS).map((p) => p.name)).toEqual(["read_file", "glob", "grep"]);
  });
});

describe("read_file", () => {
  it("returns numbered lines and honours offset/limit", async () => {
    write("r.txt", "one\ntwo\nthree\nfour");
    expect(await run("read_file", { path: "r.txt" })).toBe("    1\tone\n    2\ttwo\n    3\tthree\n    4\tfour");
    const part = await run("read_file", { path: "r.txt", offset: 2, limit: 2 });
    expect(part).toBe("    2\ttwo\n    3\tthree\n… 1 more lines");
  });

  it("needs no approval and refuses paths outside the root", async () => {
    write("r.txt", "x");
    await run("read_file", { path: "r.txt" });
    expect(asked).toEqual([]);
    await expect(run("read_file", { path: "../secret.txt" })).rejects.toThrow(/escapes/);
  });
});

describe("write_file", () => {
  it("creates files and parent directories after approval", async () => {
    const out = await run("write_file", { path: "deep/new/file.txt", content: "hello\nworld" });
    expect(out).toBe("Created deep/new/file.txt (2 lines).");
    expect(read("deep/new/file.txt")).toBe("hello\nworld");
    expect(asked[0]).toMatchObject({ tool: "write_file", detail: "create deep/new/file.txt (2 lines)" });
    expect(events.map((e) => e.name)).toEqual(["approval", "edit"]);
  });

  it("writes nothing when declined", async () => {
    answer = false;
    const out = await run("write_file", { path: "nope.txt", content: "x" });
    expect(out).toMatch(/declined/);
    expect(fs.existsSync(path.join(root, "nope.txt"))).toBe(false);
    expect(events.map((e) => e.name)).toEqual(["approval"]);
  });
});

describe("edit_file", () => {
  it("replaces a unique string", async () => {
    write("e.ts", "const a = 1;\nconst b = 2;\n");
    expect(await run("edit_file", { path: "e.ts", old_string: "b = 2", new_string: "b = 3" })).toBe("Edited e.ts (1 replacement).");
    expect(read("e.ts")).toBe("const a = 1;\nconst b = 3;\n");
  });

  it("rejects missing or ambiguous matches before asking", async () => {
    write("e.ts", "x x x");
    await expect(run("edit_file", { path: "e.ts", old_string: "y", new_string: "z" })).rejects.toThrow(/not found/);
    await expect(run("edit_file", { path: "e.ts", old_string: "x", new_string: "z" })).rejects.toThrow(/occurs 3 times/);
    expect(asked).toEqual([]);
  });

  it("replaces every match with replace_all", async () => {
    write("e.ts", "x x x");
    expect(await run("edit_file", { path: "e.ts", old_string: "x", new_string: "y", replace_all: true })).toBe("Edited e.ts (3 replacements).");
    expect(read("e.ts")).toBe("y y y");
  });

  it("matches LF text against CRLF files and keeps CRLF endings", async () => {
    write("crlf.txt", "line one\r\nline two\r\nline three\r\n");
    await run("edit_file", { path: "crlf.txt", old_string: "line one\nline two", new_string: "first\nsecond" });
    expect(read("crlf.txt")).toBe("first\r\nsecond\r\nline three\r\n");
  });

  it("treats $ in the replacement literally", async () => {
    write("d.js", "price = X;");
    await run("edit_file", { path: "d.js", old_string: "X", new_string: "'$&$1'" });
    expect(read("d.js")).toBe("price = '$&$1';");
  });

  it("leaves the file alone when declined", async () => {
    write("e.ts", "keep");
    answer = false;
    expect(await run("edit_file", { path: "e.ts", old_string: "keep", new_string: "lose" })).toMatch(/declined/);
    expect(read("e.ts")).toBe("keep");
  });
});

describe("glob and grep", () => {
  beforeEach(() => {
    write("src/a.ts", "export const needle = 1;\n");
    write("src/b.js", "// Needle in caps\n");
    write("node_modules/pkg/index.ts", "export const needle = 2;\n");
  });

  it("glob finds files and skips node_modules", async () => {
    const out = await run("glob", { pattern: "**/*.ts" });
    expect(out.split("\n")).toContain("src/a.ts");
    expect(out).not.toContain("node_modules");
    expect(await run("glob", { pattern: "**/*.nothing" })).toBe("No files matched.");
  });

  it("grep reports path:line matches, optionally case-insensitive", async () => {
    expect(await run("grep", { pattern: "needle", glob: "src/**" })).toBe("src/a.ts:1: export const needle = 1;");
    const both = await run("grep", { pattern: "needle", glob: "src/**", ignore_case: true });
    expect(both.split("\n")).toHaveLength(2);
    expect(await run("grep", { pattern: "zzz_unfindable", glob: "src/**" })).toBe("No matches.");
  });
});

describe("shell and run_tests", () => {
  const node = JSON.stringify(process.execPath);
  // PowerShell needs the call operator to run a quoted path; bash does not.
  const cmd = (script: string) => `${process.platform === "win32" ? "& " : ""}${node} -e "${script}"`;

  it("runShell captures output and exit codes", async () => {
    const ok = await runShell(cmd("console.log(42)"), root, 30_000);
    expect(ok).toMatchObject({ exitCode: 0, timedOut: false });
    expect(ok.output.trim()).toBe("42");
    const bad = await runShell(cmd("process.exit(3)"), root, 30_000);
    expect(bad.exitCode).toBe(3);
  });

  it("runShell times out long commands", async () => {
    const r = await runShell(cmd("setTimeout(()=>{},10000)"), root, 1500);
    expect(r.timedOut).toBe(true);
  });

  it("runShell stops promptly when aborted (Esc)", async () => {
    const ac = new AbortController();
    const started = Date.now();
    setTimeout(() => ac.abort(), 300);
    const r = await runShell(cmd("setTimeout(()=>{},20000)"), root, 60_000, ac.signal);
    expect(r.exitCode).toBeNull();
    expect(Date.now() - started).toBeLessThan(5000);
  }, 10_000);

  it("shell asks first, flags risky commands, and reports the result", async () => {
    const out = await run("shell", { command: cmd("console.log('hi')") });
    expect(out).toMatch(/hi[\s\S]*\[exit code 0\]/);
    expect(asked[0]).toMatchObject({ tool: "shell", risky: false });

    answer = false;
    await run("shell", { command: "rm -rf /tmp/whatever" });
    expect(asked[1].risky).toBe(true);
    const last = events.filter((e) => e.name === "shell_result").pop()!.payload as EventMap["shell_result"];
    expect(last).toMatchObject({ approved: false, risky: true, exitCode: null });
  });

  it("run_tests parses results and emits test_result", async () => {
    write(
      "suite.test.mjs",
      `import test from "node:test"; import assert from "node:assert";
test("good", () => assert.ok(true));
test("bad", () => assert.equal(1, 2));`,
    );
    const out = await run("run_tests", { command: `${process.platform === "win32" ? "& " : ""}${node} --test suite.test.mjs` });
    expect(out.split("\n")[0]).toBe("Tests: 1 failed, 1 passed");
    const result = events.find((e) => e.name === "test_result")!.payload as EventMap["test_result"];
    expect(result).toMatchObject({ failed: 1, passed: 1, parsed: true });
    expect(result.failing).toContain("bad");
  }, 30_000);
});
