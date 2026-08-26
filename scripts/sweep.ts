// Usage: node --experimental-strip-types scripts/sweep.ts <key> <lo> <hi> <steps>
// Example: node --experimental-strip-types scripts/sweep.ts enemy.speed 0.6 2.0 5
//
// Steps a lever across N values, runs a fixed scripted session for each,
// and prints the telemetry so two settings can be compared by number.
// The simulation runs headlessly at speed — no renderer, no wall-clock.
// core/ is never touched; this file only consumes its public API.

import { makeWorld } from '../src/core/sim/world.ts';
import { makeTuning } from '../src/core/tuning/store.ts';

const [key, lo, hi, steps] = [process.argv[2]!, +process.argv[3]!, +process.argv[4]!, +process.argv[5]!];

if (!key || isNaN(lo) || isNaN(hi) || isNaN(steps) || steps < 1) {
  console.error('Usage: node --experimental-strip-types scripts/sweep.ts <key> <lo> <hi> <steps>');
  console.error('Example: node --experimental-strip-types scripts/sweep.ts enemy.speed 0.6 2.0 5');
  process.exit(1);
}

const rows: Record<string, number>[] = [];
for (let i = 0; i < steps; i++) {
  const v = lo + (hi - lo) * (steps === 1 ? 0 : i / (steps - 1));
  const t = makeTuning(); t.set(key, v);
  const w = makeWorld({ seed: 42, tuning: t });
  w.placeTower(w.dungeon.heart);
  for (let k = 0; k < 6000; k++) {
    w.tick(1 / 60, { forward: (k % 120) < 60 ? 1 : -1, turn: Math.sin(k / 30), fire: k % 5 === 0 });
  }
  rows.push({ [key]: +v.toFixed(3), ...w.telemetry.summary() });
}
console.table(rows);
