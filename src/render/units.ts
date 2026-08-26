// units.ts — everything that moves, drawn from world state each frame.
//
// The renderer READS the world and never writes to it. Nothing here calls a
// world method; sync() is a pure projection of state onto buffers. That is the
// seam that keeps core/ headless and testable.
//
// The tank re-uses the turret silhouette, re-tinted. A dedicated tank model is
// M1 work; M0b does not need a third port to answer a tuning question.

import * as THREE from 'three';
import { turretPts } from '../core/models/turret.ts';
import { minePts } from '../core/models/mine.ts';
import { makePointCloud, basisAt } from './points.ts';
import { HEART_MAX_HP } from '../core/sim/world.ts';
import type { World } from '../core/sim/world.ts';
import type { Vec3 } from '../core/sphere/vec3.ts';

const CRITTER_CAP = 200;
const TOWER_CAP = 64;
const CRITTER_SCALE = 0.022;
const TOWER_SCALE = 0.03;
const TANK_SCALE = 0.028;
const HEART_SCALE = 0.055;

export type Units = { group: THREE.Group; sync(world: World): void };

export function makeUnits(): Units {
  const mine = minePts();
  const turret = turretPts();

  // sizeFactor ~0.07 of the model radius keeps points just under the mean
  // spacing of a ~500-point cloud: dense enough to read as a solid silhouette,
  // sparse enough that additive stacking does not clip to white up close.
  const DOT = 0.07;
  const critters = makePointCloud(mine, CRITTER_CAP, {
    scale: CRITTER_SCALE, sizeFactor: DOT, color: 0xff5a3c, highlight: 0xffd08a,
  });
  const towers = makePointCloud(turret, TOWER_CAP, {
    scale: TOWER_SCALE, sizeFactor: DOT, color: 0x64b5ff, highlight: 0xd8f0ff,
  });
  const tank = makePointCloud(turret, 1, {
    scale: TANK_SCALE, sizeFactor: DOT, color: 0x7ee0a8, highlight: 0xe8fff2,
  });
  const heart = makePointCloud(mine, 1, {
    scale: HEART_SCALE, sizeFactor: DOT, color: 0xff3060, highlight: 0xffc0d0,
  });

  const group = new THREE.Group();
  group.name = 'units';
  for (const c of [critters, towers, tank, heart]) group.add(c.object);

  function sync(world: World): void {
    const { mesh } = world;

    critters.begin();
    for (const c of world.critters) {
      if (!c.alive) continue;
      const n = normalOf(c.pos);
      // Heading: toward the cell it walks to, so critters face their path.
      const target = mesh.centers[c.next] ?? c.pos;
      const heading: Vec3 = [target[0] - c.pos[0], target[1] - c.pos[1], target[2] - c.pos[2]];
      critters.add(lift(c.pos, CRITTER_SCALE), CRITTER_SCALE, basisAt(n, heading), 1);
    }
    critters.end();

    towers.begin();
    for (const t of world.towers) {
      towers.add(lift(t.pos, TOWER_SCALE), TOWER_SCALE, basisAt(normalOf(t.pos), [0, 1, 0]), 1);
    }
    towers.end();

    tank.begin();
    tank.add(
      lift(world.tank.pos, TANK_SCALE),
      TANK_SCALE,
      basisAt(normalOf(world.tank.pos), world.tank.heading),
      1,
    );
    tank.end();

    // The heart dims as it takes damage — HokorobiTawaa renders remaining life
    // as dot density so you watch yourself dying, and we already own the dot
    // renderer that makes it nearly free.
    const hp = Math.max(0, world.heartHp) / HEART_MAX_HP;
    const heartPos: Vec3 = mesh.centers[world.dungeon.heart] ?? [0, 1, 0];
    heart.begin();
    heart.add(
      lift(heartPos, HEART_SCALE),
      HEART_SCALE,
      basisAt(normalOf(heartPos), [0, 1, 0]),
      0.2 + 0.8 * hp,
    );
    heart.end();
  }

  return { group, sync };
}

/** Unit sphere, so a surface position IS its own normal. */
function normalOf(p: Vec3): Vec3 {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  return [p[0] / l, p[1] / l, p[2] / l];
}

/** Push a model off the surface by roughly its own radius so it sits ON the
 *  board rather than half-buried in it. */
function lift(p: Vec3, scale: number): Vec3 {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  const k = (l + scale * 0.9) / l;
  return [p[0] * k, p[1] * k, p[2] * k];
}
