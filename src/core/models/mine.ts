// mine.ts — the M0 critter model: a spiked sphere.
//
// Chosen in docs/03-braille-assets.md because it reads as *hazard* at any size
// and from any angle — which matters on a sphere, where units are seen from
// arbitrary orientations. Its highlight dots are the spike tips, so it stays
// legible when small. (ufoPts was the runner-up; its disc silhouette collapses
// edge-on.)

import { fibDir, fitUnit } from './helpers.ts';
import type { ModelPoint } from './helpers.ts';

/** The M0 critter. 360 shell + 26 spikes x 5 segments = 490 points,
 *  26 highlights (the spike tips). */
export function minePts(): ModelPoint[] {
  const pts: ModelPoint[] = [];
  const R = 0.62;
  for (let i = 0; i < 360; i++) {
    const d = fibDir(i, 360);
    pts.push([d[0] * R, d[1] * R, d[2] * R, 0]);
  }
  const spikes = 26;
  for (let k = 0; k < spikes; k++) {
    const d = fibDir(k, spikes);
    for (let s = 1; s <= 5; s++) {
      const r = R + (s / 5) * 0.36;
      pts.push([d[0] * r, d[1] * r, d[2] * r, s === 5 ? 1 : 0]);
    }
  }
  return fitUnit(pts);
}
