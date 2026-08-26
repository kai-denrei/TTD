// towers.ts — static towers that fire at the nearest critter within range.
//
// Design:
//   - All levers read LIVE inside tick — never captured at construction.
//   - No Math.random — towers are deterministic (nearest-target, tie-break by id).
//   - Returns a DamageEvent per shot rather than mutating critters directly;
//     the World resolves damage in a single pass after all systems have ticked.

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
};

export type TowerDamageEvent = {
  towerId: number;
  critterId: number;
  damage: number;
};

// ---- Tower factory ----------------------------------------------------------

export function makeTower(id: number, cell: number, pos: Vec3): Tower {
  return { id, cell, pos, cooldown: 0, kills: 0 };
}

// ---- Tower step (returns pending damage events) -----------------------------

/**
 * Advance all towers by dt, returning damage events to be resolved by the World.
 * Towers pick the nearest alive critter within tower.range; ties broken by lowest id.
 */
export function stepTowers(
  towers: Tower[],
  critters: Critter[],
  dt: number,
  tuning: TuningStore,
): TowerDamageEvent[] {
  const damage = tuning.get('tower.damage');
  const range = tuning.get('tower.range');
  const rate = tuning.get('tower.rate');
  const events: TowerDamageEvent[] = [];

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
      events.push({ towerId: tower.id, critterId: target.id, damage });
      // Rate is seconds-per-shot; reset cooldown
      tower.cooldown = rate;
    }
  }

  return events;
}
