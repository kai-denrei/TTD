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
import { CREATURE_MODELS, FLAT_MODELS } from '../core/models/creatures.ts';
import { makePointCloud, basisAt } from './points.ts';
import { WALL_HEIGHT } from './geometry.ts';
import { HEART_MAX_HP } from '../core/sim/world.ts';
import { ENEMY_BY_TYPE } from '../core/sim/enemyspec.ts';
import type { World } from '../core/sim/world.ts';
import type { Vec3 } from '../core/sphere/vec3.ts';

const CRITTER_CAP = 200;
/** Per-species pool size. Peak concurrency is ~30 across ALL types, and a wave
 *  draws from at most a handful of species, so 48 each is generous while
 *  keeping eight extra buffers cheap. Sizing every species at CRITTER_CAP would
 *  allocate 200 slots each for types that never appear together. */
const SPECIES_CAP = 48;
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
  // One pooled cloud per species, plus the mine as the fallback. Twelve types
  // sharing one silhouette meant the roster's whole point — recognise a threat
  // before it arrives — never reached the screen. Types with no dedicated model
  // fall back to the mine, which is correct art for the ones literally named
  // after mines rather than a stopgap.
  const critters = makePointCloud(mine, CRITTER_CAP, {
    scale: CRITTER_SCALE, sizeFactor: DOT, color: 0xff5a3c, highlight: 0xffd08a,
  });
  const species = new Map<string, ReturnType<typeof makePointCloud>>();
  for (const [type, gen] of CREATURE_MODELS) {
    species.set(type, makePointCloud(gen(), SPECIES_CAP, {
      scale: CRITTER_SCALE, sizeFactor: DOT, color: 0xff5a3c, highlight: 0xffd08a,
    }));
  }
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
  for (const c of species.values()) group.add(c.object);

  function sync(world: World): void {
    const { mesh } = world;

    critters.begin();
    for (const c of species.values()) c.begin();
    for (const c of world.critters) {
      if (!c.alive) continue;
      const n = normalOf(c.pos);
      // Heading: toward the cell it walks to, so critters face their path.
      const target = mesh.centers[c.next] ?? c.pos;
      const heading: Vec3 = [target[0] - c.pos[0], target[1] - c.pos[1], target[2] - c.pos[2]];

      // Colour and size come from the enemy's TYPE. Twelve types that all look
      // identical are twelve types the player cannot plan against — the whole
      // value of a roster is that you recognise a threat before it arrives, and
      // read it off the board rather than off a UI panel.
      const spec = ENEMY_BY_TYPE.get(c.type);
      const scale = CRITTER_SCALE * (spec?.size ?? 0.45) / 0.45;
      const col = typeColor(c.type, spec?.color ?? 0xff5a3c);

      // Damage shows as DIMMING rather than a health bar: HokorobiTawaa renders
      // remaining life on the actor itself so the board stays clean and you
      // judge threat by silhouette, not chrome.
      const hpFrac = c.hpMax > 0 ? Math.max(0, c.hp) / c.hpMax : 1;
      const cloud = species.get(c.type) ?? critters;
      // Flat models lie TANGENT to the surface rather than standing on it. The
      // default frame puts model +Y along the normal, which stands a z=0 model
      // upright — and an upright flat thing disappears edge-on, which on an
      // orbiting sphere camera happens constantly. Swapping so the model's zero
      // axis takes the normal lays it on the ground: fully readable from above,
      // merely foreshortened from the chase camera.
      const b = basisAt(n, heading);
      const frame = FLAT_MODELS.has(c.type)
        ? { fwd: b.fwd, up: b.side, side: b.up }
        : b;
      cloud.add(lift(c.pos, scale), scale, frame, 0.45 + 0.55 * hpFrac, col);
    }
    critters.end();
    for (const c of species.values()) c.end();

    towers.begin();
    for (const t of world.towers) {
      // Towers stand on HIGH GROUND: clear the wall's roof, not the floor.
      towers.add(
        liftFrom(t.pos, 1 + WALL_HEIGHT, TOWER_SCALE),
        TOWER_SCALE,
        basisAt(normalOf(t.pos), [0, 1, 0]),
        1,
      );
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

/** Enemy colours are cached: ENEMY_BY_TYPE returns a hex number, and
 *  allocating a THREE.Color per critter per frame would churn garbage during
 *  exactly the busiest moments. */
const COLOR_CACHE = new Map<string, THREE.Color>();
function typeColor(type: string, hex: number): THREE.Color {
  let c = COLOR_CACHE.get(type);
  if (c === undefined) {
    c = new THREE.Color(hex);
    COLOR_CACHE.set(type, c);
  }
  return c;
}

/** Unit sphere, so a surface position IS its own normal. */
function normalOf(p: Vec3): Vec3 {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  return [p[0] / l, p[1] / l, p[2] / l];
}

/** Push a model off a surface at `base` radius by roughly its own radius, so it
 *  sits ON that surface rather than half-buried in it. Cell centres all live at
 *  radius 1 regardless of what is drawn above them, so the base is passed in
 *  rather than read from the position. */
function liftFrom(p: Vec3, base: number, scale: number): Vec3 {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  const k = (base + scale * 0.9) / l;
  return [p[0] * k, p[1] * k, p[2] * k];
}

/** Floor-standing units: critters, the tank, the heart. */
function lift(p: Vec3, scale: number): Vec3 {
  return liftFrom(p, 1, scale);
}
