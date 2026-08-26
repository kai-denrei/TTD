// loop.ts — fixed-timestep accumulator.
//
// WHY NOT rAF's dt. Determinism is a pillar (vision §5.6) and replay
// determinism is the keystone test: same seed + same preset + same inputs must
// produce byte-identical telemetry. Feeding variable frame time into
// world.tick would make two identical runs diverge from frame-timing noise
// alone, and every tuning comparison would partly be measuring the scheduler.
//
// WHY THE CLAMP. A backgrounded tab returns with seconds of accumulated time.
// Unclamped, the loop tries to run hundreds of steps in one frame, which takes
// longer than a frame, which accumulates more time — the spiral of death. We
// drop simulated time instead. For a tuning rig that is plainly the right
// trade: a stalled tab is not a run worth preserving.
//
// WHY Stepper, NOT World. Taking a two-method interface keeps this module
// Node-testable with a counting stub — no mesh generation, no three.js.

export const FIXED_DT = 1 / 60;
export const MAX_STEPS_PER_FRAME = 5;

export type Stepper = {
  step(dt: number): void;
  /** Terminal condition. M0a finding #5: a sim with no end accumulates
   *  telemetry past death, so a long run averages a real game with a
   *  post-mortem. Once true, the loop never steps again. */
  done(): boolean;
};

export type Loop = {
  advance(frameSeconds: number): number;
  readonly stepped: number;
  readonly halted: boolean;
};

export function makeLoop(
  target: Stepper,
  fixedDt: number = FIXED_DT,
  maxSteps: number = MAX_STEPS_PER_FRAME,
): Loop {
  let acc = 0;
  let stepped = 0;
  let halted = false;

  function advance(frameSeconds: number): number {
    if (halted) return 0;
    acc += frameSeconds;

    let ran = 0;
    while (acc >= fixedDt && ran < maxSteps) {
      target.step(fixedDt);
      acc -= fixedDt;
      ran++;
      stepped++;
      if (target.done()) {
        halted = true;
        acc = 0;
        return ran;
      }
    }

    // Clamped: discard the backlog rather than carrying it into the next
    // frame, which would stall every subsequent frame too.
    if (ran >= maxSteps) acc = 0;
    return ran;
  }

  return {
    advance,
    get stepped() { return stepped; },
    get halted() { return halted; },
  };
}
