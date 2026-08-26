// main.ts — the shell entry point.
//
// Architectural invariant: src/core/ never imports three.js. The brain is
// tested headless (`npm test`); this file and everything under render/ is the
// thin layer that draws it. That separation is the structural fix for what
// went wrong in the PoC, where a 3,870-line tab fused sim and render.

import { makeWorld } from './core/sim/world.ts';
import { makeTuning } from './core/tuning/store.ts';
import { makeStage } from './render/scene.ts';
import { makeBoard } from './render/board.ts';
import { makeUnits } from './render/units.ts';
import { makeRenderTarget, readRenderState } from './render/bindings.ts';
import { makeLoop } from './app/loop.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
if (!canvas) throw new Error('#scene canvas missing');

const tuning = makeTuning();
const world = makeWorld({ seed: 7, tuning });
world.placeTower(world.dungeon.heart);

const stage = makeStage(canvas);
const board = makeBoard(world.mesh, world.dungeon);
stage.scene.add(board);

const units = makeUnits();
stage.scene.add(units.group);

const loop = makeLoop({
  step: (dt) => world.tick(dt, { forward: 0, turn: 0, fire: false }),
  done: () => world.heartDied,
});

const renderTarget = makeRenderTarget();
let last = performance.now();

function frame(now: number): void {
  // Clamp the frame delta before it reaches the accumulator: a tab that was
  // backgrounded for a minute must not hand the loop a minute of backlog.
  loop.advance(Math.min((now - last) / 1000, 1));
  last = now;

  units.sync(world);

  // LIVENESS: read every render lever through tuning.get() on every frame.
  // Hoisting this out of the loop is the exact bug the rig exists to prevent.
  readRenderState(tuning, renderTarget);
  stage.postfx.applyBloom(renderTarget.bloom);
  stage.postfx.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
