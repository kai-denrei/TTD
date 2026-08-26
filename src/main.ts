// main.ts — the shell entry point.
//
// Architectural invariant: src/core/ never imports three.js. The brain is
// tested headless (`npm test`); this file and everything under render/ is the
// thin layer that draws it. That separation is the structural fix for what
// went wrong in the PoC, where a 3,870-line tab fused sim and render.

import * as THREE from 'three';
import { makeWorld } from './core/sim/world.ts';
import { makeTuning } from './core/tuning/store.ts';
import { makeStage } from './render/scene.ts';
import { makeBoard, cellFromFaceIndex } from './render/board.ts';
import { makeUnits } from './render/units.ts';
import { makeRenderTarget, readRenderState } from './render/bindings.ts';
import { makeLoop } from './app/loop.ts';
import { makeCameraRig } from './app/cameras/registry.ts';
import { makeInput } from './app/input.ts';

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
const input = makeInput(canvas, { isBuildFamily: () => rig.family === 'build' });
const raycaster = new THREE.Raycaster();

// Family IS the macro/tactical split: build = macro, tank = tactical. The
// setMacro call below is what finally gives macroShare and modeSwitches data
// — they read 0 in every M0a sweep because nothing ever called it, so the
// layer-balance pane has never been measured.
world.setMacro(true); // start in the build family

// Debug handle. Admin Mode ships in every build anyway (the door is closed,
// not the code removed), so exposing the live world costs nothing a player can
// misuse and makes the app inspectable from a headless browser — which is the
// only way to verify input plumbing that no unit test can reach.
declare global {
  interface Window { __ttd?: { world: typeof world; rig: typeof rig; input: typeof input; lastTap?: unknown } }
}
window.__ttd = { world, rig, input };

function placeFromTap(tap: { x: number; y: number }): void {
  const ndc = new THREE.Vector2(
    (tap.x / window.innerWidth) * 2 - 1,
    -(tap.y / window.innerHeight) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, stage.camera);
  const hit = raycaster.intersectObject(board, true)[0];
  // three types faceIndex as number | null, not undefined — check both.
  const faceIndex = hit?.faceIndex;
  const cell = faceIndex === undefined || faceIndex === null ? -1 : cellFromFaceIndex(faceIndex);
  if (window.__ttd) {
    window.__ttd.lastTap = { tap, hitName: hit?.object.name ?? null, faceIndex: faceIndex ?? null, cell };
  }
  if (hit === undefined || cell < 0) return;
  // world.placeTower already refuses BLOCKED and occupied cells and counts a
  // decision only on success — that rule stays owned in one place.
  if (!world.placeTower(cell)) rig.addTrauma(0.12); // a small refusal nudge
}

const loop = makeLoop({
  step: (dt) => world.tick(dt, input.tank),
  done: () => world.heartDied,
});

const renderTarget = makeRenderTarget();
let last = performance.now();

function frame(now: number): void {
  // Clamp the frame delta before it reaches the accumulator: a tab that was
  // backgrounded for a minute must not hand the loop a minute of backlog.
  const frameSeconds = Math.min((now - last) / 1000, 1);
  last = now;

  if (input.toggleFamily) {
    input.toggleFamily = false;
    world.setMacro(rig.toggleFamily() === 'build');
  }
  if (input.cycleCamera) {
    input.cycleCamera = false;
    rig.cycle();
  }
  for (const tap of input.drainTaps()) placeFromTap(tap);

  loop.advance(frameSeconds);

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
      zoom: input.zoom,
      orbitYaw: input.orbitYaw,
      orbitPitch: input.orbitPitch,
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
