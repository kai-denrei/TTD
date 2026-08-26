// Usage: node --experimental-strip-types scripts/sweep.ts <key> <lo> <hi> <steps>
// Example: node --experimental-strip-types scripts/sweep.ts enemy.speed 0.6 2.0 5
//
// Steps a lever across N values, runs a fixed scripted session for each,
// and prints the telemetry so two settings can be compared by number.
// The simulation runs headlessly at speed — no renderer, no wall-clock.
// core/ is never touched; this file only consumes its public API.

import { runHeadless } from '../src/core/sim/runner.ts';
import { LEVERS } from '../src/core/tuning/schema.ts';

const [key, lo, hi, steps] = [process.argv[2]!, +process.argv[3]!, +process.argv[4]!, +process.argv[5]!];

if (!key || isNaN(lo) || isNaN(hi) || isNaN(steps) || steps < 1) {
  console.error('Usage: node --experimental-strip-types scripts/sweep.ts <key> <lo> <hi> <steps>');
  console.error('Example: node --experimental-strip-types scripts/sweep.ts enemy.speed 0.6 2.0 5');
  process.exit(1);
}

const leverSchema = LEVERS.find((l) => l.key === key);
if (!leverSchema) {
  console.error(`Unknown lever: "${key}". Run the sweep with a valid key from schema.ts`);
  process.exit(1);
}

const rows: Record<string, number>[] = [];
for (let i = 0; i < steps; i++) {
  const v = lo + (hi - lo) * (steps === 1 ? 0 : i / (steps - 1));
  // M16: warn when sweep value is outside the lever's declared range
  if (v < leverSchema.min || v > leverSchema.max) {
    console.warn(`WARNING: sweep value ${v.toFixed(3)} for "${key}" is outside declared range [${leverSchema.min}, ${leverSchema.max}]. t.set() will clamp — this row duplicates an adjacent row.`);
  }
  // runHeadless owns what "a comparable run" means, including truncation at
  // heart death. The sweep does not re-derive it; see core/sim/runner.ts.
  const r = runHeadless({ seed: 42, preset: `${key}=${v}`, maxTicks: 6000, input: 'patrol', towers: 'heart' });
  rows.push({ [key]: +v.toFixed(3), ...r.summary });
}
// Runs truncate at heart death, so every row measures a live game only.
// survivedFor is therefore the run length, not a warning flag. Before the
// runner existed, rows ran a flat 100s and 2-63% of each was post-mortem.
console.table(rows);
