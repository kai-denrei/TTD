// towers.ts — static towers that fire at the nearest critter in range.
//
// Design:
//   - Per-tower stats come from towerspec.ts; the global tower.* levers are
//     SCALARS over the whole roster. The roster supplies identity, the levers
//     tune the board at once — which is what a difficulty pass actually wants.
//   - Range is authored in CELLS and converted with the mesh's mean chord, so
//     the roster stays correct at any board resolution.
//   - All levers read LIVE inside tick — never captured at construction.
//   - No Math.random — deterministic nearest-target, ties broken by lowest id.
//   - Returns SHOT REQUESTS, never damage. Since M0c-2 towers do not deal
//     damage: they ask for projectiles, and projectiles.ts resolves impacts.
//     The two hitscan-ish attacks (beam, slowfield) are the exception and are
//     marked so the World can resolve them immediately.

import type { Vec3 } from '../sphere/vec3.ts';
import { dist } from '../sphere/vec3.ts';
import type { TuningStore } from '../tuning/store.ts';
import type { Critter } from './critters.ts';
import type { AttackKind } from './towerspec.ts';
import { TOWER_BY_KEY, effectiveStats, SPREAD_FAN } from './towerspec.ts';

// ---- Public types -----------------------------------------------------------

export type Tower = {
  id: number;
  cell: number;
  pos: Vec3;
  cooldown: number; // seconds until next shot
  kills: number;
  /** Which TowerSpec this is. */
  key: string;
  /** Upgrade tier, 0..MAX_TIER. */
  tier: number;
  /** Total credit sunk in: purchase plus every upgrade. Drives the refund. */
  spent: number;
};

/** A tower asking to fire. `dirs` carries one direction per projectile, so a
 *  spread tower's fan is decided here — where the tower's stats live — rather
 *  than leaking pellet logic into the projectile system. */
export type TowerShotRequest = {
  towerId: number;
  critterId: number;
  damage: number;
  from: Vec3;
  dirs: Vec3[];
  attack: AttackKind;
  projSpeed: number;
  rangeWorld: number;
  splashWorld: number;
  /** slowfield only: every critter in range is touched, not just the target. */
  fieldTargets?: number[];
  slowFactor?: number;
  slowDur?: number;
};

// ---- Tower factory ----------------------------------------------------------

export function makeTower(id: number, cell: number, pos: Vec3): Tower {
  return { id, cell, pos, cooldown: 0, kills: 0, key: 'single', tier: 0, spent: 0 };
}

// ---- Tower step -------------------------------------------------------------

/**
 * Advance all towers by dt, returning shot requests for the World.
 * `meanChord` converts authored cell distances into world units.
 */
export function stepTowers(
  towers: Tower[],
  critters: Critter[],
  dt: number,
  tuning: TuningStore,
  meanChord: number,
): TowerShotRequest[] {
  const dmgScale = tuning.get('tower.damage');
  const rangeScale = tuning.get('tower.range');
  const rateScale = tuning.get('tower.rate');
  const speedScale = tuning.get('tower.projSpeed');
  const events: TowerShotRequest[] = [];

  for (const tower of towers) {
    const spec = TOWER_BY_KEY.get(tower.key);
    if (spec === undefined) continue;
    const eff = effectiveStats(spec, tower.tier);

    if (tower.cooldown > 0) tower.cooldown -= dt;
    if (tower.cooldown > 0) continue;

    const rangeWorld = eff.rangeCells * meanChord * rangeScale;
    // rate is shots/sec, so the cooldown is its reciprocal. Guarding the
    // division keeps a rate scaled to zero from producing Infinity and
    // freezing the tower in a permanent cooldown that never expires.
    const shotsPerSec = eff.rate * rateScale;
    if (shotsPerSec <= 0) continue;

    // ── slowfield: touches EVERY critter in range at once ──────────────────
    // Its value is not damage, it is what the towers beside it get to do.
    if (spec.attack === 'slowfield') {
      const inRange: number[] = [];
      for (const c of critters) {
        if (!c.alive) continue;
        if (dist(tower.pos, c.pos) <= rangeWorld) inRange.push(c.id);
      }
      if (inRange.length === 0) continue;
      events.push({
        towerId: tower.id,
        critterId: inRange[0]!,
        damage: eff.damage * dmgScale,
        from: tower.pos,
        dirs: [],
        attack: 'slowfield',
        projSpeed: 0,
        rangeWorld,
        splashWorld: 0,
        fieldTargets: inRange,
        slowFactor: eff.slowFactor,
        slowDur: eff.slowDur,
      });
      tower.cooldown = 1 / shotsPerSec;
      continue;
    }

    // ── everything else: nearest target ────────────────────────────────────
    let target: Critter | null = null;
    let bestDist = Infinity;
    for (const c of critters) {
      if (!c.alive) continue;
      const d = dist(tower.pos, c.pos);
      if (d > rangeWorld) continue;
      if (d < bestDist || (d === bestDist && target !== null && c.id < target.id)) {
        bestDist = d;
        target = c;
      }
    }
    if (target === null) continue;

    const aim: Vec3 = [
      target.pos[0] - tower.pos[0],
      target.pos[1] - tower.pos[1],
      target.pos[2] - tower.pos[2],
    ];

    // A spread tower fans its pellets around the aim direction. Fanning here
    // keeps pellet logic with the stats that define it instead of teaching the
    // projectile system what a pellet is.
    const dirs: Vec3[] = eff.pellets > 1
      ? fan(aim, tower.pos, eff.pellets, SPREAD_FAN)
      : [aim];

    events.push({
      towerId: tower.id,
      critterId: target.id,
      damage: eff.damage * dmgScale,
      from: tower.pos,
      dirs,
      attack: spec.attack,
      projSpeed: eff.projSpeed * meanChord * speedScale,
      // A shot may chase slightly past the tower's range; without the margin a
      // target at the edge of range is unhittable by construction.
      rangeWorld: rangeWorld * 1.35,
      splashWorld: eff.splashCells * meanChord,
    });
    tower.cooldown = 1 / shotsPerSec;
  }

  return events;
}

/** Fan `n` directions around `aim`, spaced `spacing` radians apart on the
 *  tangent plane at `at`. Rotating on the tangent plane rather than in free
 *  space keeps every pellet travelling along the surface. */
function fan(aim: Vec3, at: Vec3, n: number, spacing: number): Vec3[] {
  const nl = Math.hypot(at[0], at[1], at[2]) || 1;
  const up: Vec3 = [at[0] / nl, at[1] / nl, at[2] / nl];
  const d = aim[0] * up[0] + aim[1] * up[1] + aim[2] * up[2];
  const f: Vec3 = [aim[0] - up[0] * d, aim[1] - up[1] * d, aim[2] - up[2] * d];
  const fl = Math.hypot(f[0], f[1], f[2]) || 1;
  const fwd: Vec3 = [f[0] / fl, f[1] / fl, f[2] / fl];
  const side: Vec3 = [
    up[1] * fwd[2] - up[2] * fwd[1],
    up[2] * fwd[0] - up[0] * fwd[2],
    up[0] * fwd[1] - up[1] * fwd[0],
  ];
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i - (n - 1) / 2) * spacing;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.push([
      fwd[0] * c + side[0] * s,
      fwd[1] * c + side[1] * s,
      fwd[2] * c + side[2] * s,
    ]);
  }
  return out;
}
