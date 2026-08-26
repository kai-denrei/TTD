// towers.ts — static towers that fire at the nearest critter within range.
//
// Design:
//   - All levers read LIVE inside tick — never captured at construction.
//   - No Math.random — towers are deterministic (nearest-target, tie-break by id).
//   - Returns a SHOT REQUEST per firing, not damage. Since M0c-2 towers do not
//     deal damage at all: they spawn a projectile that travels, can be watched,
//     and can miss. The World turns these into projectiles; projectiles.ts
//     resolves the damage on impact.

import type { Vec3 } from '../sphere/vec3.ts';
import { dist } from '../sphere/vec3.ts';
import type { TuningStore } from '../tuning/store.ts';
import type { Critter } from './critters.ts';

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

/** A tower asking for a shot. Carries the aim direction so the renderer can
 *  place a muzzle flash along the barrel, and the target id so the projectile
 *  can home. */
export type TowerShotRequest = {
  towerId: number;
  critterId: number;
  damage: number;
  from: Vec3;
  dir: Vec3;
};

// ---- Tower factory ----------------------------------------------------------

export function makeTower(id: number, cell: number, pos: Vec3): Tower {
  return { id, cell, pos, cooldown: 0, kills: 0, key: 'single', tier: 0, spent: 0 };
}

// ---- Tower step (returns pending damage events) -----------------------------

/**
 * Advance all towers by dt, returning SHOT REQUESTS for the World to turn into
 * projectiles. Towers pick the nearest alive critter within tower.range; ties
 * broken by lowest id.
 */
export function stepTowers(
  towers: Tower[],
  critters: Critter[],
  dt: number,
  tuning: TuningStore,
): TowerShotRequest[] {
  const damage = tuning.get('tower.damage');
  const range = tuning.get('tower.range');
  const rate = tuning.get('tower.rate');
  const events: TowerShotRequest[] = [];

  for (const tower of towers) {
    // Cool down
    if (tower.cooldown > 0) {
      tower.cooldown -= dt;
    }
    if (tower.cooldown > 0) continue;

    // Find nearest alive critter within range (tie-break: smallest id)
    let target: Critter | null = null;
    let bestDist = Infinity;
    for (const c of critters) {
      if (!c.alive) continue;
      const d = dist(tower.pos, c.pos);
      if (d > range) continue;
      if (d < bestDist || (d === bestDist && target !== null && c.id < target.id)) {
        bestDist = d;
        target = c;
      }
    }

    if (target !== null) {
      const dx = target.pos[0] - tower.pos[0];
      const dy = target.pos[1] - tower.pos[1];
      const dz = target.pos[2] - tower.pos[2];
      events.push({
        towerId: tower.id,
        critterId: target.id,
        damage,
        from: tower.pos,
        dir: [dx, dy, dz],
      });
      // Rate is seconds-per-shot; reset cooldown
      tower.cooldown = rate;
    }
  }

  return events;
}
