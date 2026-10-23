import type { Hack } from "../events.js";
import { theme } from "../theme/index.js";

/** Achievement ids and their cred. Each theme names and describes them; the ids are what profiles store. */
export const REWARDS = {
  first_blood: 25,
  daemon_killer: 40,
  fork_bomb: 100,
  infinite_loop: 15,
  bricked: 10,
  night_shift: 15,
  uptime: 50,
  cracked_ice: 50,
  firewall: 10,
  gig_economy: 75,
  full_crew: 30,
} as const;

export type HackId = keyof typeof REWARDS;

export const HACK_IDS = Object.keys(REWARDS) as HackId[];

/** One achievement, dressed in the current theme. */
export function hack(id: HackId): Hack {
  return { id, ...theme().hacks[id], reward: REWARDS[id] };
}

/** Every achievement, in order, dressed in the current theme. */
export function allHacks(): Hack[] {
  return HACK_IDS.map(hack);
}

/** Ids from Ambrosia's Greek-themed releases (Larper's predecessor), so old profiles keep what they earned. */
export const LEGACY_HACK_IDS: Record<string, HackId> = {
  boss_slayer: "daemon_killer",
  hydra_slayer: "fork_bomb",
  sisyphus: "infinite_loop",
  icarus: "bricked",
  night_owl: "night_shift",
  apollo: "uptime",
  golden_fleece: "cracked_ice",
  pandora: "firewall",
  odyssey: "gig_economy",
  argonaut: "full_crew",
};
