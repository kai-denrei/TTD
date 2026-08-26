// worker.ts — runs headless sims off the main thread.
//
// core/ is pure TypeScript with no three.js, so it runs unchanged in a worker.
// That portability is the payoff of the M0a seam: the brain goes anywhere that
// runs JS, and Compare gets real numbers without dropping the render loop
// below frame rate.

import { runHeadless } from '../../core/sim/runner.ts';
import type { RunSpec, RunResult } from '../../core/sim/runner.ts';

export type CompareRequest = { id: number; specs: RunSpec[] };
export type CompareResponse = { id: number; results: RunResult[] };

self.onmessage = (e: MessageEvent<CompareRequest>): void => {
  const { id, specs } = e.data;
  const response: CompareResponse = { id, results: specs.map((s) => runHeadless(s)) };
  (self as unknown as Worker).postMessage(response);
};
