import Anthropic from "@anthropic-ai/sdk";
import type { Bus } from "../events.js";
import type { Config, CrewName } from "../config.js";
import { systemPrompt } from "./personas.js";
import { findTool, toolParams, type ApprovalRequest, type ToolContext } from "./tools.js";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentParam = Anthropic.Beta.BetaContentBlockParam;

const MAX_ITERATIONS = 60;

export interface AgentOptions {
  crew: CrewName;
  client: Anthropic;
  config: Config;
  root: string;
  bus: Bus;
  approve: (req: ApprovalRequest) => Promise<boolean>;
  /** Restrict the crew member to these tools. Omit for every tool; [] for none. */
  tools?: string[];
}

export interface RunResult {
  text: string;
  stopReason: string | null;
}

/** Models with adaptive thinking, effort and server-side refusal fallbacks. */
function isModern(model: string): boolean {
  return /^claude-(opus|sonnet|fable|mythos)-5/.test(model);
}

/**
 * One crew member's conversation. The history is append-only (never edited), which keeps
 * the prompt cache warm and replayed thinking blocks valid.
 */
export class Agent {
  readonly crew: CrewName;
  private messages: MessageParam[] = [];
  private readonly tools: Anthropic.Beta.BetaTool[];

  constructor(private opts: AgentOptions) {
    this.crew = opts.crew;
    this.tools = opts.tools && opts.tools.length === 0 ? [] : toolParams(opts.tools);
  }

  reset(): void {
    this.messages = [];
  }

  get model(): string {
    return this.opts.config.models[this.crew];
  }

  private params(): Anthropic.Beta.MessageCreateParamsNonStreaming {
    const model = this.model;
    const modern = isModern(model);
    return {
      model,
      max_tokens: modern ? 64_000 : 16_000,
      // Rebuilt each time: switching themes mid-session changes the voice, not the history.
      system: systemPrompt(this.crew, this.opts.root),
      messages: this.messages,
      cache_control: { type: "ephemeral" },
      ...(this.tools.length ? { tools: this.tools } : {}),
      ...(modern
        ? {
            thinking: { type: "adaptive", display: "summarized" },
            output_config: { effort: this.opts.config.effort[this.crew] },
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          }
        : {}),
    };
  }

  async run(prompt: string | ContentParam[], signal?: AbortSignal): Promise<RunResult> {
    const { bus, client } = this.opts;
    this.messages.push({ role: "user", content: prompt });
    bus.emit("turn_start", { crew: this.crew });

    let finalText = "";
    let stopReason: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let jsonRetries = 0;

    try {
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        if (signal?.aborted) {
          stopReason = "aborted";
          break;
        }
        const stream = client.beta.messages.stream(this.params(), { signal });
        stream.on("text", (delta) => bus.emit("text", { crew: this.crew, delta }));
        stream.on("thinking", (delta) => bus.emit("thinking", { crew: this.crew, delta }));

        let message: Anthropic.Beta.BetaMessage;
        try {
          message = await stream.finalMessage();
          jsonRetries = 0;
        } catch (err) {
          // With eager input streaming, an unparseable tool input rejects here.
          // Retry that; API errors, aborts and anything else go up.
          if (err instanceof Anthropic.APIError || signal?.aborted || jsonRetries++ >= 2) throw err;
          bus.emit("notice", { text: "A tool call arrived garbled. Asking again." });
          continue;
        }

        inputTokens += message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0);
        outputTokens += message.usage.output_tokens;
        stopReason = message.stop_reason;
        const text = message.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
        if (text) finalText = text;

        if (message.stop_reason === "refusal") {
          const category = message.stop_details?.category ?? "unspecified";
          bus.emit("notice", { text: `${this.crew} declined this request (${category}).` });
          // Don't keep a refused turn: it may hold a half-written tool call.
          break;
        }

        this.messages.push({ role: "assistant", content: message.content as ContentParam[] });

        if (message.stop_reason === "pause_turn") continue;

        const toolUses = message.content.filter(
          (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
        );
        if (toolUses.length === 0) break;

        if (message.stop_reason === "max_tokens") {
          // A tool input cut off here may parse as a valid but truncated object.
          const results: ContentParam[] = toolUses.map((t) => ({
            type: "tool_result",
            tool_use_id: t.id,
            is_error: true,
            content: "Your output hit max_tokens, so this tool call was cut off and not run. Make smaller edits.",
          }));
          this.messages.push({ role: "user", content: results });
          continue;
        }

        const results = await Promise.all(toolUses.map((t) => this.runTool(t, signal)));
        // All results go back in one user message so parallel calls stay parallel.
        this.messages.push({ role: "user", content: results });
      }
    } catch (err) {
      if (signal?.aborted) {
        stopReason = "aborted";
      } else {
        bus.emit("error", { message: describeError(err) });
        stopReason = "error";
      }
    }

    // A dangling tool_use would make the next request invalid. Close it out.
    this.closeDanglingToolUse();

    bus.emit("turn_end", { crew: this.crew, text: finalText, stopReason, inputTokens, outputTokens });
    return { text: finalText, stopReason };
  }

  private async runTool(use: Anthropic.Beta.BetaToolUseBlock, signal?: AbortSignal): Promise<ContentParam> {
    const { bus } = this.opts;
    const tool = findTool(use.name);
    if (!tool) {
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: `Unknown tool: ${use.name}` };
    }
    // The tolerant streaming parser can hand back a truncated object; validate it.
    const parsed = tool.schema.safeParse(use.input);
    if (!parsed.success) {
      return {
        type: "tool_result",
        tool_use_id: use.id,
        is_error: true,
        content: `Invalid input for ${use.name}: ${parsed.error.message}`,
      };
    }
    const input = parsed.data as never;
    const summary = tool.summarize(input);
    bus.emit("tool_start", { crew: this.crew, id: use.id, name: use.name, summary });
    const ctx: ToolContext = { root: this.opts.root, crew: this.crew, bus, approve: this.opts.approve, signal };
    try {
      const out = await tool.run(input, ctx);
      bus.emit("tool_end", { crew: this.crew, id: use.id, name: use.name, ok: true, summary: firstLine(out) });
      return { type: "tool_result", tool_use_id: use.id, content: out };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      bus.emit("tool_end", { crew: this.crew, id: use.id, name: use.name, ok: false, summary: msg });
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: msg };
    }
  }

  private closeDanglingToolUse(): void {
    const last = this.messages[this.messages.length - 1];
    if (!last || last.role !== "assistant" || typeof last.content === "string") return;
    const uses = last.content.filter((b) => b.type === "tool_use") as Anthropic.Beta.BetaToolUseBlockParam[];
    if (!uses.length) return;
    this.messages.push({
      role: "user",
      content: uses.map((u) => ({ type: "tool_result", tool_use_id: u.id, is_error: true, content: "Interrupted by the user." })),
    });
  }
}

function firstLine(s: string): string {
  const line = s.split("\n").find((l) => l.trim()) ?? "";
  return line.length > 120 ? line.slice(0, 117) + "…" : line;
}

export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Access denied: authentication failed. Set ANTHROPIC_API_KEY or run `ant auth login`.";
  }
  if (err instanceof Anthropic.RateLimitError) return "Rate limited. Try again shortly.";
  if (err instanceof Anthropic.BadRequestError) return `Bad request: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `API error ${err.status ?? ""}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

