import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { Bus } from "../src/events.js";
import { Narrator } from "../src/narrator.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { hack } from "../src/game/hacks.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(client: Anthropic | null = null) {
  const bus = new Bus();
  const narrator = new Narrator(bus, client, DEFAULT_CONFIG, "/project");
  const lines: string[] = [];
  bus.on("narration", (n) => lines.push(n.text));
  return { bus, narrator, lines };
}

const boss = { name: "Rogue AI", tier: 3, hp: 0, maxHp: 5, startHp: 2 };

describe("Narrator", () => {
  it("narrates major moments from templates when there is no API client", async () => {
    const { bus, lines } = setup();
    bus.emit("boss", { boss, change: "defeated" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/Rogue AI|Green across the board/);
  });

  it("batches a burst of events into one line", async () => {
    const { bus, lines } = setup();
    bus.emit("hack", hack("first_blood"));
    bus.emit("rank_up", { rank: "Runner" });
    bus.emit("boss", { boss, change: "defeated" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(lines).toHaveLength(1);
  });

  it("stays quiet when disabled", async () => {
    const { bus, narrator, lines } = setup();
    narrator.enabled = false;
    bus.emit("hack", hack("first_blood"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(lines).toEqual([]);
  });

  it("ignores builder turns that did not finish cleanly", async () => {
    const { bus, lines } = setup();
    bus.emit("turn_end", { crew: "builder", text: "", stopReason: "aborted", inputTokens: 0, outputTokens: 0 });
    bus.emit("turn_end", { crew: "critic", text: "", stopReason: "end_turn", inputTokens: 0, outputTokens: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(lines).toEqual([]);
  });

  it("asks the narrator model, then falls back to templates during the cooldown", async () => {
    const create = vi.fn(async (_params: any) => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: '"The whole grid cheers as the Rogue AI goes dark!"' }],
    }));
    const { bus, lines } = setup({ messages: { create } } as unknown as Anthropic);

    bus.emit("edit", { crew: "builder", path: "src/a.ts" });
    bus.emit("boss", { boss, change: "defeated" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(lines).toEqual(["The whole grid cheers as the Rogue AI goes dark!"]);
    const params = create.mock.calls[0][0];
    expect(params.model).toBe("claude-haiku-4-5");
    expect(params.messages[0].content).toContain("edited src/a.ts");
    expect(params.output_config).toBeUndefined(); // Haiku takes no effort setting

    bus.emit("hack", hack("cracked_ice"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(create).toHaveBeenCalledTimes(1);
    expect(lines[1]).toMatch(/Cracked the ICE/);
  });

  it("falls back to a template when the model call fails", async () => {
    const create = vi.fn(async () => {
      throw new Error("network down");
    });
    const { bus, lines } = setup({ messages: { create } } as unknown as Anthropic);
    bus.emit("rank_up", { rank: "Ghost" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/Ghost/);
  });
});
