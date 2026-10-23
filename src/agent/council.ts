import type { Agent } from "./loop.js";
import type { Bus } from "../events.js";
import { runShell } from "./tools.js";
import { theme } from "../theme/index.js";

export interface Crew {
  builder: Agent;
  planner: Agent;
  critic: Agent;
}

export function parseVerdict(review: string): boolean | null {
  const m = review.match(/VERDICT:\s*(APPROVED|REVISE)/i);
  return m ? m[1].toUpperCase() === "APPROVED" : null;
}

/** The working-tree diff, including new files, for the critic to judge. */
export async function currentDiff(root: string): Promise<string> {
  const tracked = await runShell("git diff HEAD --stat; git diff HEAD", root, 30_000);
  const untracked = await runShell("git ls-files --others --exclude-standard", root, 30_000);
  if (tracked.exitCode !== 0 && /not a git repository/i.test(tracked.output)) {
    return "(This project is not a git repository, so there is no diff. Review the files mentioned in the task instead.)";
  }
  const news = untracked.output.trim();
  return `${tracked.output.trim() || "(no changes to tracked files)"}${news ? `\n\nNew untracked files:\n${news}` : ""}`;
}

async function review(p: Crew, root: string, context: string, signal?: AbortSignal): Promise<{ text: string; approved: boolean }> {
  const diff = await currentDiff(root);
  const r = await p.critic.run(`${context}\n\n<diff>\n${diff.slice(0, 60_000)}\n</diff>`, signal);
  return { text: r.text, approved: parseVerdict(r.text) === true };
}

/** /heist (or the theme's name for it): the planner plans, the builder builds, the critic reviews, with one revision round if the critic objects. */
export async function runHeist(p: Crew, bus: Bus, root: string, task: string, signal?: AbortSignal): Promise<void> {
  const t = theme();
  const { builder, planner, critic } = t.crew;
  bus.emit("notice", { text: t.lines.planStart });
  const plan = await p.planner.run(`The job for this ${t.words.plan}:\n\n${task}`, signal);
  if (signal?.aborted || plan.stopReason === "error") return;

  const build = await p.builder.run(
    `The crew has a job for you.\n\nJob: ${task}\n\n${planner.title}'s plan:\n${plan.text}\n\nCarry it out. ${critic.title} will review your work afterwards.`,
    signal,
  );
  if (signal?.aborted || build.stopReason === "error") return;

  let verdict = await review(p, root, `Review ${builder.title}'s work on this job: ${task}\n\nTheir summary:\n${build.text}`, signal);
  bus.emit("review", { approved: verdict.approved });
  if (verdict.approved || signal?.aborted) return;

  bus.emit("notice", { text: theme().lines.revise });
  const fix = await p.builder.run(
    `${critic.title} reviewed your work and wants changes:\n\n${verdict.text}\n\nAddress the findings that are valid. If one is wrong, say why.`,
    signal,
  );
  if (signal?.aborted || fix.stopReason === "error") return;
  verdict = await review(p, root, `${builder.title} revised the work after your review. Their reply:\n${fix.text}\n\nJudge the current state.`, signal);
  bus.emit("review", { approved: verdict.approved });
}

/** /roast: the critic reviews whatever is currently uncommitted. */
export async function runRoast(p: Crew, bus: Bus, root: string, signal?: AbortSignal): Promise<void> {
  const verdict = await review(p, root, "Roast the uncommitted changes in this project.", signal);
  bus.emit("review", { approved: verdict.approved });
}
