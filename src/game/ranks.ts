import { theme } from "../theme/index.js";

export interface Rank {
  name: string;
  min: number;
  glyph: string;
}

/** Cred needed for each of the five ranks. The theme names them. */
export const RANK_MINS = [0, 100, 400, 1000, 2500];

/** The ranks, lowest first, dressed in the current theme. */
export function ranks(): Rank[] {
  return theme().ranks.map((r, i) => ({ ...r, min: RANK_MINS[i] }));
}

export function rankFor(xp: number): Rank {
  const all = ranks();
  let r = all[0];
  for (const rank of all) if (xp >= rank.min) r = rank;
  return r;
}

/** Progress towards the next rank, 0..1. 1 at the top rank. */
export function progress(xp: number): { rank: Rank; next: Rank | null; fraction: number } {
  const all = ranks();
  const rank = rankFor(xp);
  const next = all[all.findIndex((r) => r.min === rank.min) + 1] ?? null;
  if (!next) return { rank, next, fraction: 1 };
  return { rank, next, fraction: (xp - rank.min) / (next.min - rank.min) };
}

/** The most failing tests each foe tier covers; the theme names the tiers. */
export const THREAT_MAX = [1, 3, 6, Infinity];

/** The tier a failing suite spawns, by how many tests fail. */
export function tierFor(hp: number): number {
  return THREAT_MAX.findIndex((max) => hp <= max);
}

export function threatFor(hp: number): string {
  return theme().threats[tierFor(hp)];
}
