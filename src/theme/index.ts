import type { Theme, ThemeId } from "./types.js";
import { netrunner } from "./themes/netrunner.js";
import { olympus } from "./themes/olympus.js";
import { dungeon } from "./themes/dungeon.js";
import { starship } from "./themes/starship.js";
import { hustle } from "./themes/hustle.js";

export type { Theme, ThemeId, CrewSkin, NarrationKind } from "./types.js";

export const THEMES: Record<ThemeId, Theme> = { netrunner, olympus, dungeon, starship, hustle };
export const DEFAULT_THEME: ThemeId = "netrunner";

let current: Theme = THEMES[DEFAULT_THEME];

/** The theme everything is dressed in right now. Read it at use, not at import, so a switch shows up everywhere. */
export function theme(): Theme {
  return current;
}

export function setTheme(id: ThemeId): Theme {
  current = THEMES[id];
  return current;
}

/** A theme by id, name or alias, ignoring case: "linkedin" finds Hustle. */
export function findTheme(name: string | undefined): Theme | undefined {
  const key = name?.trim().toLowerCase();
  if (!key) return undefined;
  return Object.values(THEMES).find((t) => t.id === key || t.name.toLowerCase() === key || t.aliases.includes(key));
}

/** Fill a template's {placeholders}. {s} pluralises against {n}; unknown names are left blank. */
export function fill(template: string, vars: Record<string, string | number> = {}): string {
  const all: Record<string, string | number> = { s: vars.n === 1 ? "" : "s", ...vars };
  return template.replace(/\{(\w+)\}/g, (_, k) => String(all[k] ?? ""));
}
