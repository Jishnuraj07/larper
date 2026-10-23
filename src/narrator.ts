import Anthropic from "@anthropic-ai/sdk";
import type { Bus } from "./events.js";
import type { Config } from "./config.js";
import { systemPrompt } from "./agent/personas.js";
import { fill, theme, type NarrationKind } from "./theme/index.js";

function pick(kind: NarrationKind, vars: Record<string, string | number>): string {
  const lines = theme().narration[kind] ?? theme().narration.done;
  return fill(lines[Math.floor(Math.random() * lines.length)], vars);
}

const API_COOLDOWN_MS = 20_000;

/**
 * The narrator (Pirate Radio, Hermes, the Bard...) watches the bus and comments.
 * Notable moments are batched; a line is written by the cheap narrator model when
 * one was not used recently, and from the theme's templates otherwise (or when
 * there is no API access).
 */
export class Narrator {
  enabled = true;
  private log: string[] = [];
  private template: { kind: NarrationKind; vars: Record<string, string | number> } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastApi = 0;

  constructor(
    private bus: Bus,
    private client: Anthropic | null,
    private config: Config,
    private root: string,
  ) {
    bus.on("edit", (e) => this.note(`edited ${e.path}`));
    bus.on("test_result", (r) => this.note(`ran tests: ${r.failed} failed, ${r.passed} passed`));
    bus.on("shell_result", (r) => r.approved && this.note(`ran \`${r.command.slice(0, 60)}\` (exit ${r.exitCode})`));
    bus.on("boss", ({ boss, change }) => {
      if (!boss || change === "none") return;
      this.note(`${theme().words.foe} ${change}: ${boss.name} at ${boss.hp}/${boss.maxHp} hp`);
      this.trigger(change, { boss: boss.name, hp: boss.hp }, change === "spawn" || change === "defeated");
    });
    bus.on("hack", (l) => {
      this.note(`${theme().words.achievement} earned: ${l.title} (${l.description})`);
      this.trigger("hack", { title: l.title }, true);
    });
    bus.on("rank_up", (r) => {
      this.note(`player promoted to ${r.rank}`);
      this.trigger("rank_up", { rank: r.rank }, true);
    });
    bus.on("approval", (a) => {
      if (a.approved) return;
      this.note(`the user refused to let ${theme().crew[a.crew].title} run ${a.tool}: ${a.summary.slice(0, 60)}`);
      this.trigger("denied", {}, false);
    });
    bus.on("review", (r) => this.note(`${theme().crew.critic.title} ${r.approved ? "approved" : "rejected"} the work`));
    bus.on("error", () => this.trigger("error", {}, false));
    bus.on("turn_end", (t) => {
      if (t.crew !== "builder" || t.stopReason !== "end_turn") return;
      this.note(`${theme().crew.builder.title} finished the ${theme().words.job}`);
      this.trigger("done", {}, true);
    });
  }

  private note(line: string): void {
    this.log.push(line);
    if (this.log.length > 12) this.log.shift();
  }

  /** Schedule a line. `major` moments always get one; minor ones only sometimes. */
  private trigger(kind: NarrationKind, vars: Record<string, string | number>, major: boolean): void {
    if (!this.enabled) return;
    if (!major && Math.random() < 0.5) return;
    // Keep the most dramatic template if several moments land together.
    if (!this.template || major) this.template = { kind, vars };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 900);
  }

  private async flush(): Promise<void> {
    this.timer = null;
    const events = this.log.splice(0);
    const template = this.template;
    this.template = null;
    if (!this.enabled || !template) return;

    let text = "";
    if (this.client && Date.now() - this.lastApi > API_COOLDOWN_MS && events.length) {
      this.lastApi = Date.now();
      text = await this.fromModel(events);
    }
    if (!text) text = pick(template.kind, template.vars);
    this.bus.emit("narration", { text });
  }

  private async fromModel(events: string[]): Promise<string> {
    const model = this.config.models.narrator;
    try {
      const r = await this.client!.messages.create({
        model,
        max_tokens: 1024,
        system: systemPrompt("narrator", this.root),
        ...(model.startsWith("claude-haiku") ? {} : { output_config: { effort: "low" as const } }),
        messages: [{ role: "user", content: `What just happened:\n- ${events.join("\n- ")}` }],
      });
      if (r.stop_reason === "refusal") return "";
      const text = r.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .trim()
        .replace(/^["']|["']$/g, "");
      return text.split("\n")[0].slice(0, 200);
    } catch {
      return ""; // fall back to a template
    }
  }
}
