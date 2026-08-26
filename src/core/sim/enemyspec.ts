// enemyspec.ts — the enemy roster: twelve creatures that ask twelve questions.
//
// PORTED FROM the PoC's src/enemyspec.js, which had already extracted the
// roster out of the two tabs that were drifting apart. Its numbers come from
// HokorobiTawaa (bounties and the on-hit reactions verbatim) plus three
// originals — phage, amoeba, jellyfish. Port, don't copy: re-typed, the
// optional-flag soup turned into a discriminated set of documented fields, and
// the shared 1.2 s reaction window hoisted to a named constant instead of being
// restated in prose three times.
//
// WHY TWELVE AND NOT ONE WITH AN HP SLIDER. Same argument as the tower roster
// (see towerspec.ts): a lineup that varies only in hp and speed is one enemy
// with a difficulty knob, and the board would pose the same question every
// wave. The differences that matter are STRUCTURAL, and each one invalidates a
// tactic that worked the wave before:
//   - rammable   → the tank can farm it for free; the moment a type stops being
//                  rammable the tank's cheapest answer is gone.
//   - regen      → punishes chip damage; you must commit burst or lose ground.
//   - slowOnHit  → shooting it helps you twice, so it rewards the same play.
//   - accelOnHit → shooting it helps it, which inverts the reflex the first
//                  nine waves trained. This is the roster's real twist.
//   - heavy/boss → arrives in ones and twos, so area damage stops paying.
//
// RELATION TO THE GLOBAL LEVERS. `speed` multiplies the board's base enemy
// speed rather than replacing it, so `enemy.speed` stays a live difficulty
// lever over the whole roster; `size` multiplies cellSide for the same reason
// (a roster in absolute world units would break on a re-tessellated sphere).
// `bounty` and `heartDmg` are ABSOLUTE — per-type payout is the economy's whole
// point of difference, and a heart is a heart.

/** Seconds an on-hit reaction (slowOnHit / accelOnHit) is held before the
 *  critter reverts to its normal speed envelope. One shared window across the
 *  roster on purpose: the reaction is meant to read as a property of the
 *  CREATURE, and per-type durations would make it read as noise instead. */
export const HIT_REACT_DUR = 1.2;

/** Seconds a regenerator must go unhit before `regen` starts ticking. Equal to
 *  HIT_REACT_DUR by coincidence of the reference's tuning, not by dependence —
 *  they are separate numbers because they answer separate questions. */
export const REGEN_DELAY = 1.2;

export type EnemySpec = {
  type: string;
  label: string;
  hp: number;
  /** Multiplies the board's base enemy speed lever — never an absolute. */
  speed: number;
  /** Multiplies cellSide, so the roster survives a re-tessellated sphere. */
  size: number;
  /** Hearts lost when it reaches the core. Absolute. */
  heartDmg: number;
  /** Credit awarded on kill, before the streak multiplier. Absolute. */
  bounty: number;
  color: number;
  /** True if the tank kills it by driving over it. The tank's free answer —
   *  and the roster revokes it at wave 7, which is the difficulty cliff. */
  rammable: boolean;
  /** Wanders off the direct line to the core, so it cannot be intercepted by
   *  aiming where it is going. */
  erratic?: boolean;
  /** HP per second recovered after REGEN_DELAY seconds unhit. */
  regen?: number;
  /** Speed multiplier (<1) held for HIT_REACT_DUR after taking a hit. */
  slowOnHit?: number;
  /** Speed multiplier (>1) held for HIT_REACT_DUR after taking a hit. */
  accelOnHit?: number;
  /** Epic tier: spawns sparse, so area damage stops paying its way. */
  heavy?: boolean;
  /** One per wave at most. Mutually exclusive with heavy. */
  boss?: boolean;
  help: string;
};

// Colors are HokorobiTawaa's palette for the borrowed types — hue encodes
// class, brightness encodes threat rank — so a player who knows that game reads
// the field correctly on sight. The three originals keep their own tints.
// NOTE: the palette is deliberately NOT injective. scoutufo and drifter share
// E_YELLOW because they share a class; the mesh silhouette separates them.
export const ENEMIES: readonly EnemySpec[] = [
  {
    type: 'phage', label: 'THE PHAGE',
    hp: 1, speed: 1.15, size: 0.40, heartDmg: 1, bounty: 3, color: 0xffb84d,
    rammable: true, erratic: true,
    help: 'The tutorial threat: fast, fragile, worth almost nothing. Its job is to teach that the tank can farm by driving, which every later type then charges you for.',
  },
  {
    type: 'ghost', label: 'WAVE GHOST',
    hp: 1, speed: 1.25, size: 0.42, heartDmg: 1, bounty: 6, color: 0xfff07a,
    rammable: true, erratic: true,
    help: 'A phage that outruns a lazily placed tower. Same answer as the phage, but the answer now has to be aimed.',
  },
  {
    type: 'scoutufo', label: 'SCOUT UFO',
    hp: 1, speed: 1.40, size: 0.42, heartDmg: 1, bounty: 7, color: 0xffe14a,
    rammable: true, erratic: true,
    help: 'The fastest thing in the game. Straight shots miss it, which is what makes homing worth its cost.',
  },
  {
    type: 'amoeba', label: 'THE AMOEBA',
    hp: 1, speed: 0.75, size: 0.50, heartDmg: 1, bounty: 16, color: 0x66ff88,
    rammable: true,
    help: 'Slow, blind, and the best payout on the board for its hp — the first wave you can actually bank from. Not erratic: it is the type you can leave to a tower and go elsewhere.',
  },
  {
    type: 'jellyfish', label: 'THE JELLYFISH',
    hp: 1, speed: 0.95, size: 0.45, heartDmg: 1, bounty: 14, color: 0xff5fd0,
    rammable: true,
    help: 'A faster amoeba for slightly less money. Together they set the price of a wave you can safely ignore.',
  },
  {
    type: 'gslime', label: 'GREEN SLIME',
    hp: 2, speed: 0.70, size: 0.50, heartDmg: 1, bounty: 12, color: 0x53ff8a,
    rammable: true, regen: 0.25,
    help: 'The first type that punishes chip damage: leave it alone for REGEN_DELAY seconds and the work is undone. Still rammable, so the tank remains the clean answer — deliberately, since the very next wave takes ramming away.',
  },
  {
    type: 'drifter', label: 'WAVE SATURN',
    hp: 2, speed: 0.85, size: 0.52, heartDmg: 1, bounty: 15, color: 0xffe14a,
    rammable: false, erratic: true,
    help: 'The cliff. The first creature the tank cannot simply drive over, and it wanders while you work it out. Everything after this point costs towers.',
  },
  {
    type: 'corona', label: 'CORONAVIRUS',
    hp: 2, speed: 0.80, size: 0.50, heartDmg: 2, bounty: 15, color: 0xff6a5a,
    rammable: false, slowOnHit: 0.6,
    help: 'Doubles the cost of leaking, and shooting it helps you twice. A reward for the reflex the next wave punishes.',
  },
  {
    type: 'barbed', label: 'BARBED MINE',
    hp: 3, speed: 0.70, size: 0.55, heartDmg: 2, bounty: 20, color: 0xff3020,
    rammable: false, accelOnHit: 1.9,
    help: 'Inverts the corona: nearly double speed the instant you hit it. Chipping it is worse than ignoring it, so it must be killed in one committed burst or routed around.',
  },
  {
    type: 'rolling', label: 'ROLLING MINE',
    hp: 4, speed: 0.65, size: 0.60, heartDmg: 2, bounty: 28, color: 0xff9a2e,
    rammable: false, slowOnHit: 0.55, heavy: true,
    help: 'Epic tier: arrives in ones and twos, so splash and spread stop paying. Slows under fire, which makes it the one heavy a single good tower can hold alone.',
  },
  {
    type: 'prime', label: 'PRIME MINE',
    hp: 6, speed: 0.55, size: 0.65, heartDmg: 2, bounty: 45, color: 0xb44bff,
    rammable: false, regen: 0.35, heavy: true,
    help: 'The most hp and the biggest payout: a sustained-damage check. Sparse spawns plus regen means overlapping coverage beats total dps spread thin.',
  },
  {
    type: 'knot', label: 'SOLVING TORUS',
    hp: 5, speed: 0.60, size: 0.80, heartDmg: 3, bounty: 34, color: 0xff1f1f,
    rammable: false, accelOnHit: 1.7, boss: true,
    help: 'The boss, and pointedly NOT the tankiest thing on the board — the prime has more hp. The threat is three hearts a leak and acceleration under fire: a boss you must burst down, not grind, and the run ends if you do it slowly.',
  },
];

export const ENEMY_BY_TYPE: ReadonlyMap<string, EnemySpec> = new Map(
  ENEMIES.map((e) => [e.type, e]),
);

/** One new type per wave, in the reference's difficulty order (agile →
 *  regenerator → armored → dangerous → epic → boss). This drives wave
 *  composition: wave N draws from the first N types, so the ladder IS the
 *  difficulty curve and the table order above is only presentation.
 *
 *  `role` is the announce card's one-line flavor, kept verbatim from the PoC.
 *  The card's ram badge comes from `rammable` on the spec, never from this
 *  string — the sibling-drift that made this a shared module in the first place
 *  started exactly there. `label` is likewise on the spec, not repeated here. */
export type EnemyIntro = {
  wave: number;
  type: string;
  role: string;
};

export const INTROS: readonly EnemyIntro[] = [
  { wave: 1, type: 'phage', role: 'agile swarm · hunt its source' },
  { wave: 2, type: 'ghost', role: 'agile flyer' },
  { wave: 3, type: 'scoutufo', role: 'fast scout' },
  { wave: 4, type: 'amoeba', role: 'crawler · destroy the spawn' },
  { wave: 5, type: 'jellyfish', role: 'pulse drifter' },
  { wave: 6, type: 'gslime', role: 'regenerator — ram it before it heals' },
  { wave: 7, type: 'drifter', role: 'erratic drifter' },
  { wave: 8, type: 'corona', role: 'armored ×2 · slows when shot' },
  { wave: 9, type: 'barbed', role: 'SPEEDS UP when shot' },
  { wave: 10, type: 'rolling', role: 'epic · slows when shot' },
  { wave: 11, type: 'prime', role: 'epic-rare · REGENERATES' },
  { wave: 12, type: 'knot', role: 'accelerates when hit · 3 heart damage' },
];

/** Types available at a wave: the first min(wave, 12) INTROS, in ladder order.
 *  Clamped at both ends rather than throwing — waves past the last intro keep
 *  drawing from the full roster, which is how endless mode continues. */
export function typesByWave(wave: number): readonly string[] {
  const n = Math.max(1, Math.min(INTROS.length, Math.floor(wave) || 1));
  return INTROS.slice(0, n).map((iv) => iv.type);
}
