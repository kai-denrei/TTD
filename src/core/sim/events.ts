// events.ts — how the simulation says what happened.
//
// WHY THIS EXISTS. M0b rendered state and not events: the world resolved tower
// damage, kills, heart hits and tank contacts every tick and then discarded all
// of it, exposing only the surviving positions. A tower killing a critter was a
// state transition with no visual trace — the critter was simply gone next
// frame. That is the whole of "towers don't fire, or it's hard to tell".
//
// CLEARED PER TICK, NOT ON DRAIN. A headless sweep has no renderer to drain
// this, and 6,000 ticks of accumulated impacts would be an unbounded allocation
// in the one code path that has to stay cheap. The world clears at the start of
// every tick, so the buffer holds at most one frame's events regardless of
// whether anyone is listening; a renderer draining after tick() sees exactly
// that frame.
//
// POSITIONS, NOT REFERENCES. A critter that died this tick is pruned before the
// renderer looks at anything, and holding a reference to a dead entity is how a
// renderer ends up drawing — or resurrecting — things that no longer exist.

import type { Vec3 } from '../sphere/vec3.ts';

export type EventSource = 'tower' | 'tank';

export type WorldEvent =
  | { kind: 'shotFired'; at: Vec3; dir: Vec3; source: EventSource }
  | { kind: 'beam'; from: Vec3; to: Vec3 }
  | { kind: 'impact'; at: Vec3; damage: number; source: EventSource }
  | { kind: 'critterDied'; at: Vec3; by: EventSource }
  | { kind: 'heartHit'; at: Vec3 }
  | { kind: 'tankHit'; at: Vec3 };

export type EventBuffer = {
  emit(e: WorldEvent): void;
  drain(): WorldEvent[];
  clear(): void;
  readonly length: number;
};

/** Capacity is a hard ceiling: overflow is dropped, never grown into. Same
 *  reasoning as the render pools in points.ts — a reallocation during the
 *  busiest frame of the game is worse than a missing spark. */
export function makeEventBuffer(capacity = 512): EventBuffer {
  const items: WorldEvent[] = [];
  return {
    emit(e) {
      if (items.length >= capacity) return;
      items.push(e);
    },
    drain() {
      if (items.length === 0) return [];
      const out = items.slice();
      items.length = 0;
      return out;
    },
    clear() {
      items.length = 0;
    },
    get length() {
      return items.length;
    },
  };
}
