import { EventEmitter } from "node:events";
import type { CrewName } from "./config.js";
import type { ThemeId } from "./theme/index.js";

export interface TestResult {
  passed: number;
  failed: number;
  failing: string[];
  /** False when no runner summary was recognised and counts came from the exit code. */
  parsed: boolean;
}

export interface Boss {
  /** The current theme's name for this tier. */
  name: string;
  /** 0-3: how big the foe is, which the theme turns into a name. */
  tier: number;
  hp: number;
  maxHp: number;
  startHp: number;
}

export interface Hack {
  id: string;
  title: string;
  description: string;
  reward: number;
}

/** Every event the harness emits. The agent emits the first group; the game emits the rest. */
export interface EventMap {
  turn_start: { crew: CrewName };
  text: { crew: CrewName; delta: string };
  thinking: { crew: CrewName; delta: string };
  tool_start: { crew: CrewName; id: string; name: string; summary: string };
  tool_end: { crew: CrewName; id: string; name: string; ok: boolean; summary: string };
  approval: { crew: CrewName; tool: string; summary: string; approved: boolean; risky: boolean };
  edit: { crew: CrewName; path: string };
  shell_result: { crew: CrewName; command: string; exitCode: number | null; risky: boolean; approved: boolean };
  test_result: TestResult;
  review: { approved: boolean };
  turn_end: { crew: CrewName; text: string; stopReason: string | null; inputTokens: number; outputTokens: number };
  error: { message: string };
  notice: { text: string };

  xp: { amount: number; reason: string; total: number };
  rank_up: { rank: string };
  hack: Hack;
  boss: { boss: Boss | null; change: "spawn" | "hit" | "grow" | "defeated" | "none" };
  narration: { text: string };
  theme: { id: ThemeId };
}

export type EventName = keyof EventMap;

export class Bus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  emit<K extends EventName>(name: K, payload: EventMap[K]): void {
    this.emitter.emit(name, payload);
  }

  on<K extends EventName>(name: K, listener: (payload: EventMap[K]) => void): () => void {
    this.emitter.on(name, listener);
    return () => this.emitter.off(name, listener);
  }
}
