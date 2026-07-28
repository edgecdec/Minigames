/**
 * RNGdle — pull a number, chase rarity.
 *
 * A roll is 1..MAX. Rarity comes from how close to MAX you land, and every roll
 * has an independent chance of being "golden" (a shiny variant).
 */

export const MAX_ROLL = 10_000;
export const GOLDEN_CHANCE = 1 / 50;
/** Rolls available per calendar day. */
export const DAILY_ROLLS = 10;

export type Tier = "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic";

export interface TierDef {
  tier: Tier;
  label: string;
  /** Minimum roll value, inclusive. */
  min: number;
  color: string;
  /** Rough odds, for display. */
  odds: string;
}

/** Descending so the first match wins. */
export const TIERS: TierDef[] = [
  { tier: "mythic", label: "Mythic", min: 10_000, color: "#ff4fd8", odds: "1 in 10,000" },
  { tier: "legendary", label: "Legendary", min: 9_950, color: "#ffd76a", odds: "1 in 200" },
  { tier: "epic", label: "Epic", min: 9_750, color: "#c07bff", odds: "1 in 40" },
  { tier: "rare", label: "Rare", min: 9_000, color: "#5cc8ff", odds: "1 in 10" },
  { tier: "uncommon", label: "Uncommon", min: 7_500, color: "#7ce8a4", odds: "1 in 4" },
  { tier: "common", label: "Common", min: 1, color: "#8f92aa", odds: "3 in 4" },
];

export function tierFor(roll: number): TierDef {
  return TIERS.find((t) => roll >= t.min) ?? TIERS[TIERS.length - 1];
}

export interface Roll {
  value: number;
  golden: boolean;
  tier: Tier;
}

export interface RngdleState {
  /** Which calendar day these rolls belong to, so a new day resets them. */
  dayKey: string;
  rolls: Roll[];
  rollsLeft: number;
}

export function createState(dayKey: string, rolls: Roll[] = []): RngdleState {
  return { dayKey, rolls, rollsLeft: Math.max(0, DAILY_ROLLS - rolls.length) };
}

/**
 * One roll from the supplied RNG. Callers pass a *seeded* RNG advanced past the
 * rolls already taken, so re-opening the page reproduces the same day exactly.
 */
export function makeRoll(rng: () => number): Roll {
  const value = 1 + Math.floor(rng() * MAX_ROLL);
  const golden = rng() < GOLDEN_CHANCE;
  return { value, golden, tier: tierFor(value).tier };
}

/** Replays `count` rolls from a fresh seeded RNG — the daily puzzle is fixed. */
export function rollsForDay(rng: () => number, count: number): Roll[] {
  const out: Roll[] = [];
  for (let i = 0; i < count; i++) out.push(makeRoll(rng));
  return out;
}

export function bestRoll(rolls: Roll[]): Roll | null {
  if (rolls.length === 0) return null;
  return rolls.reduce((a, b) => {
    // Golden wins ties; otherwise the higher value.
    if (b.value > a.value) return b;
    if (b.value === a.value && b.golden && !a.golden) return b;
    return a;
  });
}

/** Score for the leaderboard: the day's best roll, +10% for golden. */
export function dayScore(rolls: Roll[]): number {
  const best = bestRoll(rolls);
  if (!best) return 0;
  return Math.round(best.value * (best.golden ? 1.1 : 1));
}
