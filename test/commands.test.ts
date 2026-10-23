import { afterEach, describe, expect, it } from "vitest";
import { accept, commandList, completions } from "../src/commands.js";
import { setTheme } from "../src/theme/index.js";

const names = (line: string) => completions(line).map((c) => c.name);

afterEach(() => setTheme("netrunner"));

describe("slash-command completion", () => {
  it("offers every main command for a bare slash, and nothing once there's a space", () => {
    expect(names("/")).toEqual(commandList().filter((c) => !c.alias).map((c) => c.name));
    expect(names("/theme ")).toEqual([]);
    expect(names("fix the tests")).toEqual([]);
  });

  it("matches by prefix under the current theme's names", () => {
    expect(names("/h")).toEqual(["/heist", "/hacks", "/help"]);
    expect(names("/T")).toEqual(["/theme", "/tts"]);
    setTheme("olympus");
    expect(names("/l")).toEqual(["/labours"]);
  });

  it("falls back to another theme's names only when nothing else matches", () => {
    expect(names("/q")).toEqual(["/quit"]);
    expect(names("/que")).toEqual(["/quest"]);
    expect(names("/ex")).toEqual(["/exit"]);
    expect(commandList().filter((c) => c.name === "/heist")).toHaveLength(1);
  });

  it("leaves a space after commands that take an argument", () => {
    const [heist] = completions("/hei");
    const [roast] = completions("/ro");
    expect(accept(heist)).toBe("/heist ");
    expect(accept(roast)).toBe("/roast");
  });
});
