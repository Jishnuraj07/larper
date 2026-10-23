import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { confine } from "../src/agent/safety.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "larper-safety-"));
fs.mkdirSync(path.join(root, "src"));
fs.writeFileSync(path.join(root, "src", "a.ts"), "");

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("confine", () => {
  it("allows paths inside the root, existing or new", () => {
    expect(confine(root, "src/a.ts")).toBe(path.join(fs.realpathSync(root), "src", "a.ts"));
    expect(confine(root, "new/dir/file.txt")).toBe(path.join(fs.realpathSync(root), "new", "dir", "file.txt"));
  });

  it("refuses escapes", () => {
    expect(() => confine(root, "../outside.txt")).toThrow(/escapes/);
    expect(() => confine(root, "src/../../x")).toThrow(/escapes/);
    expect(() => confine(root, path.join(os.tmpdir(), "elsewhere.txt"))).toThrow(/escapes/);
  });
});
