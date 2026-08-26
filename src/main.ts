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
import { makeCameraRig } from './app/cameras/registry.ts';

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

const rig = makeCameraRig();
const camState = { zoom: 1, orbitYaw: 0.6, orbitPitch: 0.35 };

// TAB switches family, C cycles within it. Family IS the macro/tactical split:
// build = macro, tank = tactical. This setMacro call is what finally gives
// macroShare and modeSwitches data — they read 0 in every M0a sweep because
// nothing ever called it, so the layer-balance pane has never been measured.
window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') {
    e.preventDefault();
    world.setMacro(rig.toggleFamily() === 'build');
  } else if (e.code === 'KeyC') {
    rig.cycle();
  }
});
world.setMacro(true); // start in the build family

const loop = makeLoop({
  step: (dt) => world.tick(dt, { forward: 0, turn: 0, fire: false }),
  done: () => world.heartDied,
});

const renderTarget = makeRenderTarget();
let last = performance.now();

function frame(now: number): void {
  // Clamp the frame delta before it reaches the accumulator: a tab that was
  // backgrounded for a minute must not hand the loop a minute of backlog.
  const frameSeconds = Math.min((now - last) / 1000, 1);
  loop.advance(frameSeconds);
  last = now;

  // LIVENESS: read every render lever through tuning.get() on every frame.
  // Hoisting this out of the loop is the exact bug the rig exists to prevent.
  // Read BEFORE the rig updates so camera.shakeGain is current this frame.
  readRenderState(tuning, renderTarget);

  units.sync(world);

  const tp = world.tank.pos;
  const tl = Math.hypot(tp[0], tp[1], tp[2]) || 1;
  const cam = rig.update(
    Math.min(frameSeconds, 0.1),
    {
      anchor: tp,
      normal: [tp[0] / tl, tp[1] / tl, tp[2] / tl],
      heading: world.tank.heading,
      t: world.elapsed,
      zoom: camState.zoom,
      orbitYaw: camState.orbitYaw,
      orbitPitch: camState.orbitPitch,
    },
    renderTarget.camera.shakeGain,
  );
  stage.camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
  stage.camera.up.set(cam.up[0], cam.up[1], cam.up[2]);
  stage.camera.lookAt(cam.look[0], cam.look[1], cam.look[2]);

  stage.postfx.applyBloom(renderTarget.bloom);
  stage.postfx.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
