// towerspec.ts — the tower roster: eight towers that feel different.
//
// PORTED FROM the PoC's src/towers.js, whose numbers in turn came from
// HokorobiTawaa. Both references agree on the table, so this is a settled
// design rather than a guess. Port, don't copy: re-typed, and the damage scale
// is converted once here rather than at every call site.
//
// WHY EIGHT AND NOT ONE WITH SLIDERS. M0's spec deliberately shipped one tower
// so nothing could hide behind variety, and that was right for building the
// rig. But vision §6.4 names per-tower projectile tempo as "what stops towers
// feeling samey", and a roster whose members differ only in damage numbers is
// one tower with a slider. The differences that matter here are STRUCTURAL:
// a mortar that lofts and detonates whether or not it hits, a field that
// touches every enemy in range at once, a hitscan beam with no travel at all.
//
// DAMAGE SCALE — AND THE MISTAKE WORTH NOT REPEATING. The references quote
// damage on a 1-90 scale; TTD critters carry 1-20 HP with a default of 5. The
// first attempt rescaled damage and HP INDEPENDENTLY onto TTD's range, which
// silently broke the only thing that matters: a single-shot tower went from
// killing a baseline enemy in ~2 hits to needing 6, and every tower lever read
// dead because towers stopped killing anything at all.
//
// What has to be preserved is the DAMAGE-TO-HP RATIO. The reference's baseline
// tower does 14 against a 20 HP enemy — two shots. TTD's default critter has
// 5 HP, so the same two-shot feel needs ~2.5 damage, giving the factor below.
// Ratios between towers are then exact, and the absolutes land where the rest
// of TTD's numbers already live.

export type AttackKind = 'single' | 'spread' | 'homing' | 'slowfield' | 'mortar' | 'beam';

export type TowerSpec = {
  key: string;
  label: string;
  cost: number;
  /** Damage per shot, on TTD's 1-20 critter HP scale. */
  damage: number;
  /** Range in CELLS; multiply by mean chord for world units. */
  rangeCells: number;
  /** Shots per second. */
  rate: number;
  /** Projectile speed in cells/sec. Ignored by beam and slowfield. */
  projSpeed: number;
  attack: AttackKind;
  color: number;
  /** spread only: pellets per shot, fanned by SPREAD_FAN radians. */
  pellets?: number;
  /** mortar only: splash radius in cells. */
  splashCells?: number;
  /** slowfield only. */
  slowFactor?: number;
  slowDur?: number;
  help: string;
};

/** Reference damage -> TTD damage, preserving the damage:HP ratio.
 *  14 damage vs a 20 HP enemy is two shots; 2.52 vs TTD's 5 HP default is the
 *  same two shots. Everything else follows from that one anchor. */
const HP_RATIO = 2.52 / 14;
const HK = (d: number): number => +(d * HP_RATIO).toFixed(3);

export const SPREAD_FAN = 0.22; // radians between pellets

export const TOWERS: readonly TowerSpec[] = [
  {
    key: 'single', label: 'Single Shot', cost: 40, damage: HK(14),
    rangeCells: 3.7, rate: 1.4, projSpeed: 20, attack: 'single', color: 0xeaf2ff,
    help: 'The baseline. One shot, one target, no tricks — the tower every other tower is measured against.',
  },
  {
    key: 'rapid', label: 'Rapid', cost: 70, damage: HK(7),
    rangeCells: 3.5, rate: 3.0, projSpeed: 26, attack: 'single', color: 0x6fe6ff,
    help: 'Half the damage, twice the tempo. Shines against swarms of weak critters and wastes itself on armour.',
  },
  {
    key: 'spread', label: 'Spread', cost: 80, damage: HK(6),
    rangeCells: 3.1, rate: 1.0, projSpeed: 15, attack: 'spread', color: 0x2fe6d0,
    pellets: 5,
    help: 'Five pellets in a fan. Devastating into a packed lane, nearly useless against one target at distance.',
  },
  {
    key: 'homing', label: 'Homing', cost: 90, damage: HK(9),
    rangeCells: 3.5, rate: 1.2, projSpeed: 13, attack: 'homing', color: 0x5a9bff,
    help: 'Slow shots that steer. The answer to fast critters that outrun a straight shot.',
  },
  {
    key: 'slow', label: 'Slow Field', cost: 100, damage: HK(4),
    rangeCells: 3.5, rate: 1.0, projSpeed: 0, attack: 'slowfield', color: 0xc4e6ff,
    slowFactor: 0.45, slowDur: 1.6,
    help: 'Touches EVERY critter in range at once for chip damage and a heavy slow. A force multiplier, not a killer — its value is what the towers beside it get to do.',
  },
  {
    key: 'aoe', label: 'Mortar', cost: 110, damage: HK(12),
    rangeCells: 3.5, rate: 0.9, projSpeed: 3.5, attack: 'mortar', color: 0x9fc4ff,
    splashCells: 1.5,
    help: 'Lofts a shell that detonates at its target point whether or not it hits anything. Slow enough to dodge, which is why it is aimed at crowds rather than individuals.',
  },
  {
    key: 'sniper', label: 'Sniper', cost: 130, damage: HK(62),
    rangeCells: 7.0, rate: 0.7, projSpeed: 42, attack: 'single', color: 0xffffff,
    help: 'Twice the reach of anything else and a shot that one-shots most things. Rare, deliberate, and helpless if swarmed.',
  },
  {
    key: 'laser', label: 'Laser', cost: 220, damage: HK(18),
    rangeCells: 5.3, rate: 1.5, projSpeed: 0, attack: 'beam', color: 0x9ff5ff,
    help: 'Hitscan: no travel time, so it cannot miss and cannot be outrun. The most expensive tower, and the only one whose damage is guaranteed.',
  },
];

export const TOWER_BY_KEY: ReadonlyMap<string, TowerSpec> = new Map(
  TOWERS.map((t) => [t.key, t]),
);

/** Unlock order — wave N grants the first N towers. Deliberately not the table
 *  order: the roster is ordered by cost, but the ladder introduces one new IDEA
 *  at a time (single, then tempo, then area, then control...). */
export const TOWER_ORDER: readonly string[] = [
  'single', 'rapid', 'spread', 'slow', 'homing', 'aoe', 'sniper', 'laser',
];

/** Which towers wave `wave` has unlocked: the first N of TOWER_ORDER.
 *
 *  Both references introduce ONE NEW IDEA PER WAVE rather than opening the
 *  whole shop at once, and that pacing is most of what makes early waves
 *  teach instead of overwhelm. A player handed eight towers on wave 1 has to
 *  evaluate a matrix; a player handed a second tower on wave 2 has to answer a
 *  question. */
export function unlockedKeys(wave: number): readonly string[] {
  const n = Math.max(1, Math.min(TOWER_ORDER.length, Math.floor(wave)));
  return TOWER_ORDER.slice(0, n);
}

export const MAX_TIER = 2;

/** Cost to move a tower from `tier` to `tier + 1`, or null at max tier.
 *  The second upgrade costs more than the first AND more than the tower — the
 *  reference's curve, which pushes you to spread investment before deepening
 *  it. */
export function upgradeCost(spec: TowerSpec, tier: number): number | null {
  if (tier === 0) return Math.round(spec.cost * 0.7);
  if (tier === 1) return Math.round(spec.cost * 1.2);
  return null;
}

export type EffectiveStats = {
  damage: number;
  rangeCells: number;
  rate: number;
  projSpeed: number;
  pellets: number;
  splashCells: number;
  slowFactor: number;
  slowDur: number;
};

/** Stats for a tower at a given tier.
 *
 *  Growth is uniform (+55% damage, +8% range, +10% rate per tier) EXCEPT for a
 *  tier-2 signature bonus that deepens what each tower already is, rather than
 *  making every tower converge on the same shape as it levels. That asymmetry
 *  is the point: a fully upgraded spread is more of a shotgun, not a better
 *  generalist. */
export function effectiveStats(spec: TowerSpec, tier: number): EffectiveStats {
  const t = Math.max(0, Math.min(MAX_TIER, tier));
  const out: EffectiveStats = {
    damage: spec.damage * (1 + 0.55 * t),
    rangeCells: spec.rangeCells * (1 + 0.08 * t),
    rate: spec.rate * (1 + 0.1 * t),
    projSpeed: spec.projSpeed,
    pellets: spec.pellets ?? 1,
    splashCells: spec.splashCells ?? 0,
    slowFactor: spec.slowFactor ?? 1,
    slowDur: spec.slowDur ?? 0,
  };
  if (t >= 2) {
    if (spec.attack === 'mortar') out.splashCells *= 1.4;
    else if (spec.attack === 'spread') out.pellets += 2;
    else if (spec.attack === 'beam' || spec.attack === 'homing') out.rangeCells *= 1.3;
    else if (spec.attack === 'single') out.rate *= 1.2;
    // slowfield gets no signature bonus in either reference — its tier value is
    // the uniform growth, which on a field that touches everything is already
    // the largest absolute gain in the roster.
  }
  return out;
}

/** Refund for selling. `spent` is purchase plus every upgrade paid, so a fully
 *  upgraded tower refunds proportionally — repositioning stays affordable at
 *  every stage rather than only while cheap. */
export function sellRefund(spent: number, fraction: number): number {
  return Math.round(spent * fraction);
}
