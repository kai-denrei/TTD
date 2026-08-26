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
import { makeEffects } from './render/effects.ts';
import { makeRings } from './render/rings.ts';
import { makeShop, cellSize, rangeWorld } from './ui/shop.ts';
import { TOWER_BY_KEY } from './core/sim/towerspec.ts';
import { isFrontierWall } from './core/sphere/dungeon.ts';
import { makeRenderTarget, readRenderState } from './render/bindings.ts';
import { makeLoop } from './app/loop.ts';
import { makeCameraRig } from './app/cameras/registry.ts';
import { makeInput } from './app/input.ts';
import { makeHud } from './ui/hud.ts';
import { installGate } from './ui/admin/gate.ts';
import { makeDashboard } from './ui/admin/dashboard.ts';
import { parsePresetParam } from './ui/admin/presets.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
if (!canvas) throw new Error('#scene canvas missing');

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('#app missing');

const tuning = makeTuning();
// Applied BEFORE makeWorld so the first tick already sees it — applying after
// construction would leave one tick of default tuning in every shared link.
const urlPreset = parsePresetParam(window.location.search);
if (urlPreset !== null) tuning.import(urlPreset);

const world = makeWorld({ seed: 7, tuning });
world.placeTower(world.dungeon.heart);

const stage = makeStage(canvas);
const board = makeBoard(world.mesh, world.dungeon);
stage.scene.add(board);

const units = makeUnits();
stage.scene.add(units.group);

// Combat effects read the event feed the simulation publishes each tick. This
// is the channel M0b lacked entirely, which is why tower fire was invisible.
const effects = makeEffects();
stage.scene.add(effects.group);

const rings = makeRings();
stage.scene.add(rings.group);

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
  interface Window { __ttd?: { world: typeof world; rig: typeof rig; input: typeof input; lastTap?: unknown; camPos?: [number, number, number] } }
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

  // Tapping a tower you already own inspects it: a sticky ring showing exactly
  // what it covers. This is the common reason to tap a wall you have built on.
  const standing = world.towers.find((t) => t.cell === cell);
  if (standing !== undefined) {
    showRange(cell, standing.key, standing.tier, 0);
    return;
  }

  if (world.placeTower(cell, shop.selectedKey)) {
    showRange(cell, shop.selectedKey, 0, 0); // sticky: what you just bought
    return;
  }

  // Refused. Only draw the "what it would have covered" ring when the cell was
  // genuinely BUILDABLE — i.e. the refusal was about money, not placement.
  // Flashing a range ring over solid rock answers a question nobody asked and
  // reads as noise; flashing it over valid high ground you cannot yet afford
  // is the shop telling you what the next forty credits buy.
  rig.addTrauma(0.12);
  if (isFrontierWall(world.mesh, world.dungeon, cell)) {
    showRange(cell, shop.selectedKey, 0, 0.6);
  }
}

const loop = makeLoop({
  step: (dt) => world.tick(dt, input.tank),
  done: () => world.heartDied,
});

const hud = makeHud(app);
const shop = makeShop(world, app);
/** World units per cell — the unit tower ranges are authored in. */
const CELL = cellSize(world);

/** Draw the range a tower of `key` at `tier` actually covers from `cell`.
 *  tower.range is read LIVE here, never captured: a ring drawn from a stale
 *  lever is a picture of a tower that does not exist. */
function showRange(cell: number, key: string, tier: number, ttl: number): void {
  const spec = TOWER_BY_KEY.get(key);
  const pos = world.mesh.centers[cell];
  if (spec === undefined || pos === undefined) return;
  rings.show(pos, rangeWorld(spec, tier, CELL, tuning.get('tower.range')), spec.color, ttl);
}

// Admin Mode is a leaf: nothing in core/ or render/ imports it, and the
// dashboard is only constructed once the gate actually opens.
let dashboard: ReturnType<typeof makeDashboard> | null = null;
const gate = installGate(app);
gate.onOpen(() => {
  if (dashboard !== null) return;
  dashboard = makeDashboard(tuning, app);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') dashboard?.toggle();
  });
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
  effects.sync(world.drainEvents(), world.projectiles, frameSeconds, renderTarget.fx);
  hud.sync(world);
  shop.sync();
  rings.sync(frameSeconds);
  dashboard?.sync(world);
  if (loop.halted) hud.showRunOver(world.telemetry.summary());

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
  if (window.__ttd) window.__ttd.camPos = [cam.pos[0], cam.pos[1], cam.pos[2]];
  stage.camera.up.set(cam.up[0], cam.up[1], cam.up[2]);
  stage.camera.lookAt(cam.look[0], cam.look[1], cam.look[2]);

  stage.postfx.applyBloom(renderTarget.bloom);
  stage.postfx.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
