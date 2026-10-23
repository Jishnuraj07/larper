import type { CrewName } from "../config.js";
import type { HackId } from "../game/hacks.js";

export type ThemeId = "netrunner" | "olympus" | "dungeon" | "starship" | "hustle";

/** How one crew role looks and sounds in a theme. The role itself never changes. */
export interface CrewSkin {
  title: string;
  glyph: string;
  color: string;
  /** Flavour shown beside the spinner while this crew member works. */
  workingLines: string[];
}

/** The parts of each system prompt a theme fills in; the instructions around them are shared. */
export interface PromptSkin {
  /** "a coding heist": what the planner and critic are part of. */
  mission: string;
  builder: { who: string; persona: string; aside: string };
  planner: { who: string; voice: string };
  critic: { who: string; stance: string; tone: string; jab: string };
  narrator: { who: string; style: string };
}

export type NarrationKind = "spawn" | "grow" | "hit" | "defeated" | "hack" | "rank_up" | "denied" | "error" | "done";

/**
 * Everything the player sees that a theme can change. Rules, rewards, ids and
 * thresholds live in the game; a theme only names and dresses them.
 *
 * Lines are templates: {builder}, {critic}, {foe}, {n}, {s}, {rank}, {tool} and
 * friends are filled in where they are used.
 */
export interface Theme {
  id: ThemeId;
  name: string;
  /** Other names /theme and --theme accept. */
  aliases: string[];
  tagline: string;
  crew: Record<CrewName, CrewSkin>;
  prompts: PromptSkin;
  /** Five ranks, lowest first. The cred needed for each is fixed by the game. */
  ranks: Array<{ name: string; glyph: string }>;
  /** Four foes, smallest first: 1, up to 3, up to 6, and more failing tests. */
  threats: [string, string, string, string];
  hacks: Record<HackId, { title: string; description: string }>;
  words: {
    /** The points: "cred". */
    xp: string;
    /** A failing suite, generically: "threat", "threats". */
    foe: string;
    foes: string;
    /** Achievements, and the slash command that lists them: "hack", "hacks". */
    achievement: string;
    achievements: string;
    /** The plan-build-review command, and what it is called: "heist". */
    plan: string;
    /** A single job for the builder: "job", "jobs". */
    job: string;
    jobs: string;
    /** The approval prompt and whoever answers it: "Operator check", "Operator". */
    gate: string;
    operator: string;
    /** What happens to a beaten foe: "purged". */
    defeated: string;
  };
  icons: { xp: string; foe: string; hit: string; grow: string; won: string; unlock: string; gate: string; error: string };
  lines: {
    welcome: string;
    placeholder: string;
    emptySub: string;
    busy: string;
    topRank: string;
    rankUp: string;
    rankUpTitle: string;
    risky: string;
    allClear: string;
    noFoe: string;
    foeSpawn: string;
    foeGrow: string;
    foeHit: string;
    foeDefeated: string;
    regression: string;
    gateYes: string;
    gateAlways: string;
    gateNo: string;
    planStart: string;
    revise: string;
    soundOn: string;
    soundOff: string;
    ttsOn: string;
    ttsOff: string;
    seriousOn: string;
    seriousOff: string;
    cleared: string;
    quit: string;
    themeSet: string;
  };
  narration: Record<NarrationKind, string[]>;
  /** Terminal colours. The desktop app has its own palette per theme in style.css. */
  colors: { accent: string; signal: string; danger: string; banner: [string, string, string, string, string] };
  /** A celebration line for wins, achievements and rank-ups in the terminal. */
  flair: string;
  /** An ink-spinner (cli-spinners) name for the working line. */
  spinner: "binary" | "star" | "dots" | "arc" | "bouncingBar" | "toggle" | "moon" | "line" | "squareCorners";
}
