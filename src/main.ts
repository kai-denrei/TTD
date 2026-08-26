// main.ts — the shell. Boots the app, owns the canvas and the loop.
//
// Architectural invariant: src/core/ never imports three.js. The brain is
// testable headless (`npm test`); this file and everything under render/ is
// the thin layer that draws it. That separation is the structural fix for
// what went wrong in the PoC, where a 3,870-line tab fused sim and render.

import { stream } from './core/sim/rng.ts';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app missing');

// M0 placeholder — the board, tuning rig and telemetry land here next.
const seed = 7;
const rng = stream(seed, 'boot');
const boot = document.createElement('div');
boot.className = 'boot';
boot.innerHTML =
  `<b>TTD</b><div>tank tower defense</div>` +
  `<div>scaffold · seed ${seed} · ${rng().toFixed(6)}</div>` +
  `<div>M0: the tuning rig</div>`;
app.appendChild(boot);
