import { THEMES, theme } from "./theme/index.js";

/** A slash command as the autocomplete menu shows it. */
export interface Command {
  name: string;
  /** What follows the name, if anything: "<task>". */
  args?: string;
  about: string;
  /** Another theme's name for a command; offered only when nothing else matches. */
  alias?: boolean;
}

/** The commands under the current theme's names, then every other name that still works. */
export function commandList(): Command[] {
  const t = theme();
  const { builder, planner, critic } = t.crew;
  const plan = `/${t.words.plan}`;
  const achievements = `/${t.words.achievements}`;
  const planCmd: Command = { name: plan, args: "<task>", about: `${planner.title} plans, ${builder.title} builds, ${critic.title} reviews` };
  const achCmd: Command = { name: achievements, about: `${t.words.achievements} earned and still to earn` };
  const themeCmd: Command = { name: "/theme", args: "[name]", about: "list the themes, or switch to one" };
  const quitCmd: Command = { name: "/quit", about: t.lines.quit };
  const main: Command[] = [
    planCmd,
    { name: "/roast", about: `${critic.title} reviews your uncommitted changes` },
    { name: "/stats", about: `your rank, ${t.words.xp} and record` },
    achCmd,
    themeCmd,
    { name: "/mute", about: "toggle sound" },
    { name: "/tts", about: "toggle spoken narration" },
    { name: "/serious", about: "toggle the fun" },
    { name: "/clear", about: "wipe the conversation" },
    { name: "/help", about: "list the commands" },
    quitCmd,
  ];

  const taken = new Set(main.map((c) => c.name));
  const aliases = (of: Command, names: string[]): Command[] =>
    names.filter((n) => !taken.has(n) && taken.add(n)).map((name) => ({ ...of, name, alias: true }));
  return [
    ...main,
    ...aliases(planCmd, ["/heist", "/council", ...Object.values(THEMES).map((x) => `/${x.words.plan}`)]),
    ...aliases(achCmd, ["/hacks", "/labours", "/achievements", ...Object.values(THEMES).map((x) => `/${x.words.achievements}`)]),
    ...aliases(themeCmd, ["/themes"]),
    ...aliases(quitCmd, ["/exit"]),
  ];
}

/**
 * The commands to offer for what has been typed so far: nothing unless the line is a
 * bare "/word" with no space yet. Aliases only show when no main command matches.
 */
export function completions(line: string, list: Command[] = commandList()): Command[] {
  if (!/^\/\S*$/.test(line)) return [];
  const word = line.toLowerCase();
  const hits = list.filter((c) => !c.alias && c.name.startsWith(word));
  return hits.length ? hits : list.filter((c) => c.alias && c.name.startsWith(word));
}

/** The line after accepting a command: arguments get a space to type into. */
export const accept = (c: Command): string => (c.args ? `${c.name} ` : c.name);
