import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_THEME, findTheme, type ThemeId } from "./theme/index.js";

/** The crew's roles. Each theme gives them their own names and voices. */
export type CrewName = "builder" | "planner" | "critic" | "narrator";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface Config {
  theme: ThemeId;
  models: Record<CrewName, string>;
  effort: Record<CrewName, Effort>;
  sound: boolean;
  tts: boolean;
  narrator: boolean;
  /** Tools that never ask for approval. Read-only tools are always allowed. */
  autoApprove: string[];
  /** For API keys not scoped to a workspace. ANTHROPIC_WORKSPACE_ID overrides it. */
  workspaceId?: string;
}

export const DEFAULT_CONFIG: Config = {
  theme: DEFAULT_THEME,
  models: {
    builder: "claude-opus-5-5",
    planner: "claude-opus-5-5",
    critic: "claude-sonnet-5-5",
    narrator: "claude-haiku-4-5",
  },
  effort: { builder: "high", planner: "high", critic: "low", narrator: "low" },
  sound: true,
  tts: false,
  narrator: true,
  autoApprove: [],
};

/** Where config and profile live. LARPER_HOME overrides it (used by tests). */
export function larperHome(): string {
  return process.env.LARPER_HOME ?? path.join(os.homedir(), ".larper");
}

/**
 * Crew keys from Ambrosia, Larper's single-theme predecessor: the Greek gods of
 * 1.0-1.1 and the netrunner crew of 1.2. An existing config keeps its choices.
 */
const LEGACY_CREW: Record<string, CrewName> = {
  hephaestus: "builder",
  athena: "planner",
  momus: "critic",
  hermes: "narrator",
  fabricator: "builder",
  strategos: "planner",
  blackice: "critic",
  radio: "narrator",
};

function migrateCrew<T>(byName: Record<string, T> | undefined): Partial<Record<CrewName, T>> {
  const out: Partial<Record<CrewName, T>> = {};
  for (const [name, value] of Object.entries(byName ?? {})) {
    // A current key beats the legacy one it replaced, whichever comes first.
    if (LEGACY_CREW[name]) out[LEGACY_CREW[name]] ??= value;
    else out[name as CrewName] = value;
  }
  return out;
}

/**
 * First run of Larper on a machine that ran Ambrosia: bring the config and the
 * player's progress over from ~/.ambrosia. Only for the default home.
 */
function adoptAmbrosiaHome(): void {
  if (process.env.LARPER_HOME) return;
  const old = path.join(os.homedir(), ".ambrosia");
  if (fs.existsSync(larperHome()) || !fs.existsSync(old)) return;
  try {
    fs.mkdirSync(larperHome(), { recursive: true });
    for (const name of ["config.json", "profile.json", "desktop.json"]) {
      if (fs.existsSync(path.join(old, name))) fs.copyFileSync(path.join(old, name), path.join(larperHome(), name));
    }
  } catch {
    // Starting fresh is fine.
  }
}

function configFile(): string {
  return path.join(larperHome(), "config.json");
}

export function loadConfig(): Config {
  adoptAmbrosiaHome();
  let user: Partial<Config> = {};
  try {
    user = JSON.parse(fs.readFileSync(configFile(), "utf8"));
  } catch {
    // First run: write the defaults so they are easy to discover and edit.
    try {
      fs.mkdirSync(larperHome(), { recursive: true });
      fs.writeFileSync(configFile(), JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
    } catch {
      // A read-only home is fine; defaults still apply.
    }
  }
  return {
    ...DEFAULT_CONFIG,
    ...user,
    // An Ambrosia config has no theme; it carries on in the netrunner look it had.
    theme: findTheme(user.theme)?.id ?? DEFAULT_CONFIG.theme,
    models: { ...DEFAULT_CONFIG.models, ...migrateCrew(user.models) },
    effort: { ...DEFAULT_CONFIG.effort, ...migrateCrew(user.effort) },
  };
}

/** Remember the chosen theme in config.json, leaving the rest of the file as the user wrote it. */
export function saveTheme(id: ThemeId): void {
  try {
    let user: Record<string, unknown>;
    try {
      user = JSON.parse(fs.readFileSync(configFile(), "utf8"));
    } catch {
      user = { ...DEFAULT_CONFIG };
    }
    user.theme = id;
    fs.mkdirSync(larperHome(), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(user, null, 2) + "\n");
  } catch {
    // The switch still holds for this session.
  }
}
