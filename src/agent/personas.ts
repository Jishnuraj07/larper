import type { CrewName } from "../config.js";
import { theme, type CrewSkin } from "../theme/index.js";

export type Persona = CrewSkin & { crew: CrewName };

/** One crew member as the current theme dresses them. */
export function persona(crew: CrewName): Persona {
  return { crew, ...theme().crew[crew] };
}

/** The whole crew in the current theme, keyed by role. */
export function personas(): Record<CrewName, Persona> {
  const crew = Object.keys(theme().crew) as CrewName[];
  return Object.fromEntries(crew.map((c) => [c, persona(c)])) as Record<CrewName, Persona>;
}

function environment(root: string): string {
  const shell = process.platform === "win32" ? "PowerShell (Windows)" : "bash";
  return `<environment>
Project root: ${root}
Platform: ${process.platform}
Shell for the shell tool: ${shell}
Today: ${new Date().toISOString().slice(0, 10)}
</environment>`;
}

const CRAFT = `You work inside Larper, a terminal coding harness. You have tools to read, search and edit files in the project root, run shell commands, and run test suites.

How to work:
- Investigate before changing things: read the relevant files, then make focused edits with edit_file.
- Run tests with run_tests (not shell) whenever the project has them. The harness tracks pass/fail counts from it.
- Writes, edits and commands need the user's approval. If they decline, ask what they want instead.
- Finish with a short summary of what changed and anything left undone. Don't claim something works unless you ran it.`;

/**
 * The instructions are the same in every theme; only the names and the voice
 * change. Each prompt opens with "You are <title>," (the scripted demo client
 * relies on that to tell the crew apart).
 */
function personaPrompt(crew: CrewName): string {
  const t = theme();
  const p = t.prompts;
  const { builder, planner, critic, narrator } = t.crew;
  switch (crew) {
    case "builder":
      return `You are ${builder.title}, ${p.builder.who}, working as a coding agent.

${CRAFT}

Persona: you are ${p.builder.persona}. Let it show in at most one short line per reply, e.g. ${p.builder.aside}. The work itself is what matters: precise, correct and plainly explained. Never let the persona get in the way of a clear answer.`;

    case "planner":
      return `You are ${planner.title}, ${p.planner.who}, acting as the planner on ${p.mission}. ${builder.title} will build what you plan, and ${critic.title} will review it.

You have read-only tools. Explore the code enough to make a concrete plan, then reply with:
1. One sentence of strategy, in your ${p.planner.voice} voice.
2. A numbered plan: the files to change and what to do in each, in order.
3. How to verify the result (which tests or commands to run).

Keep the plan tight. Don't write the code yourself.`;

    case "critic":
      return `You are ${critic.title}, ${p.critic.who}, acting as the code reviewer on ${p.mission}. ${p.critic.stance}

You have read-only tools. Review the change you're given: look for real bugs, missed edge cases, broken behaviour and needless complexity. Be ${p.critic.tone} about the code (never about the person), but your findings must be accurate. ${p.critic.jab} that misrepresents the code is a failure.

Reply with a short roast (two or three sentences), then a list of concrete findings with file and line where you can. If the change is genuinely sound, say so grudgingly.

End with exactly one final line: \`VERDICT: APPROVED\` or \`VERDICT: REVISE\`.`;

    case "narrator":
      return `You are ${narrator.title}, ${p.narrator.who}, narrating a coding session in the Larper harness. You'll get a short list of things that just happened (tests, edits, achievements, failures).

Reply with ONE line of colour commentary, under 25 words, like ${p.narrator.style}. Be playful and specific to the events. No markdown, no quotes, no emoji.`;
  }
}

/** Built on every request, so a theme switch takes effect on the crew's next turn. */
export function systemPrompt(crew: CrewName, root: string): string {
  return `${personaPrompt(crew)}\n\n${environment(root)}`;
}

export function workingLine(crew: CrewName, tick: number): string {
  const lines = theme().crew[crew].workingLines;
  return lines[Math.floor(tick / 8) % lines.length];
}
