import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { Agent } from "../src/agent/loop.js";
import { Bus } from "../src/events.js";
import { DEFAULT_CONFIG } from "../src/config.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "larper-loop-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

type Msg = Omit<Partial<Anthropic.Beta.BetaMessage>, "content"> & { content: unknown[] };

/** A stand-in for the SDK client that replays scripted responses and records each request. */
function fakeClient(script: Msg[]) {
  const requests: any[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: any) {
          requests.push(JSON.parse(JSON.stringify(params)));
          const msg = script.shift()!;
          const handlers: Record<string, (d: string) => void> = {};
          return {
            on(name: string, fn: (d: string) => void) {
              handlers[name] = fn;
              return this;
            },
            async finalMessage() {
              for (const b of msg.content as any[]) if (b.type === "text") handlers.text?.(b.text);
              return { usage: { input_tokens: 10, output_tokens: 5 }, stop_details: null, ...msg };
            },
          };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, requests };
}

describe("Agent loop", () => {
  it("runs tools through the Operator check, feeds results back, and emits events", async () => {
    const { client, requests } = fakeClient([
      {
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "Powering up the rig." },
          { type: "tool_use", id: "t1", name: "write_file", input: { path: "hello.txt", content: "hi" } },
        ],
      },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Done. Wrote hello.txt." }] },
    ]);
    const bus = new Bus();
    const events: string[] = [];
    for (const n of ["turn_start", "tool_start", "tool_end", "approval", "edit", "turn_end"] as const) {
      bus.on(n, () => events.push(n));
    }
    const asked: string[] = [];
    const agent = new Agent({
      crew: "builder",
      client,
      config: DEFAULT_CONFIG,
      root,
      bus,
      approve: async (req) => {
        asked.push(req.tool);
        return true;
      },
    });

    const result = await agent.run("write hello.txt");

    expect(result).toEqual({ text: "Done. Wrote hello.txt.", stopReason: "end_turn" });
    expect(fs.readFileSync(path.join(root, "hello.txt"), "utf8")).toBe("hi");
    expect(asked).toEqual(["write_file"]);
    expect(events).toEqual(["turn_start", "tool_start", "approval", "edit", "tool_end", "turn_end"]);

    const [first, second] = requests;
    expect(first).toMatchObject({
      model: "claude-opus-5-5",
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "high" },
      fallbacks: "default",
      betas: ["server-side-fallback-2026-07-01"],
    });
    expect(first.tools.every((t: any) => t.eager_input_streaming)).toBe(true);
    // Append-only history: the second request extends the first.
    expect(second.messages.slice(0, 1)).toEqual(first.messages);
    expect(second.messages[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1" });
  });

  it("returns invalid tool input as an error result instead of running it", async () => {
    const { client, requests } = fakeClient([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "read_file", input: { nope: 1 } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] },
    ]);
    const agent = new Agent({ crew: "builder", client, config: DEFAULT_CONFIG, root, bus: new Bus(), approve: async () => true });
    await agent.run("read something");
    expect(requests[1].messages[2].content[0]).toMatchObject({ is_error: true });
  });

  it("declined actions are reported back to the model", async () => {
    const { client, requests } = fakeClient([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "shell", input: { command: "echo hi" } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "understood" }] },
    ]);
    const agent = new Agent({ crew: "builder", client, config: DEFAULT_CONFIG, root, bus: new Bus(), approve: async () => false });
    await agent.run("run something");
    expect(requests[1].messages[2].content[0].content).toMatch(/declined/);
  });

  it("drops refused turns and leaves no dangling tool use", async () => {
    const { client } = fakeClient([{ stop_reason: "refusal", content: [] }]);
    const bus = new Bus();
    const notices: string[] = [];
    bus.on("notice", (n) => notices.push(n.text));
    const agent = new Agent({ crew: "builder", client, config: DEFAULT_CONFIG, root, bus, approve: async () => true });
    const r = await agent.run("something");
    expect(r.stopReason).toBe("refusal");
    expect(notices[0]).toMatch(/declined/);
  });

  it("sends no thinking or fallbacks to Haiku", async () => {
    const { client, requests } = fakeClient([{ stop_reason: "end_turn", content: [{ type: "text", text: "hi" }] }]);
    const config = { ...DEFAULT_CONFIG, models: { ...DEFAULT_CONFIG.models, critic: "claude-haiku-4-5" } };
    const agent = new Agent({ crew: "critic", client, config, root, bus: new Bus(), approve: async () => true, tools: [] });
    await agent.run("roast");
    expect(requests[0].thinking).toBeUndefined();
    expect(requests[0].fallbacks).toBeUndefined();
    expect(requests[0].tools).toBeUndefined();
  });
});
