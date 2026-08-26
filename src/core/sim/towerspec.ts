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
// DAMAGE SCALE. The references quote damage on a 1-90 scale against enemies
// with 20-500 HP; TTD's critters carry 1-20. The conversion is `hk / 90 * 6`,
// applied once at the table so the ratios between towers — which are the
// design — survive exactly while the absolute numbers land on TTD's scale.

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

/** The references quote damage 1-90 against 20-500 HP enemies; TTD critters
 *  carry 1-20 HP. Converting once here keeps the RATIOS — which are the actual
 *  design — while landing the absolutes on our scale. */
const HK = (d: number): number => +((d / 90) * 6).toFixed(3);

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
