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
import { makeRenderTarget, readRenderState } from './render/bindings.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
if (!canvas) throw new Error('#scene canvas missing');

const tuning = makeTuning();
const world = makeWorld({ seed: 7, tuning });

const stage = makeStage(canvas);
stage.scene.add(makeBoard(world.mesh, world.dungeon));

const renderTarget = makeRenderTarget();

function frame(): void {
  // LIVENESS: read every render lever through tuning.get() on every frame.
  // Hoisting this out of the loop is the exact bug the rig exists to prevent.
  readRenderState(tuning, renderTarget);
  stage.postfx.applyBloom(renderTarget.bloom);
  stage.postfx.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
