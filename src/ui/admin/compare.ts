// compare.ts — the A/B adjudicator. Spec §9.8 is the real acceptance
// criterion: "run a tuning session and say which of two settings was better,
// citing a number."
//
// WHY HEADLESS, NOT SNAPSHOTS OF PLAYED RUNS. Two played sessions differ in
// how the tank was driven as much as in the lever under test — exactly the
// noise the sweep exists to avoid. Compare runs the pure sim instead, with
// identical scripted input on both sides, so the lever really is the only
// difference.
//
// WHY THREE SEEDS. M0a brain-notes §2: all critters share one RNG stream, so
// changing a combat lever changes which critters survive, which shifts every
// later critter's envelope draws. Runs at different settings are not directly
// comparable at the per-critter level. Multi-seed averaging is a MITIGATION,
// NOT A FIX — hence the label in the UI. Never present a single run as truth.

import type { TuningStore } from '../../core/tuning/store.ts';
import type { RunSpec, RunResult } from '../../core/sim/runner.ts';
import { meanSummaries } from '../../core/sim/runner.ts';

export const COMPARE_SEEDS: readonly number[] = [42, 43, 44];

/** The metrics worth reading at a glance. survivedFor first: M0a found it the
 *  cleanest difficulty signal (monotone 61.6s -> 37.1s as enemy.speed 0.6 -> 2.0). */
// NOTE ON heartHits: it is deliberately NOT here. Runs truncate at heart
// death, so for any run that ends in death heartHits saturates at the heart's
// max HP and reads 20 vs 20 with a delta of zero — a metric that looks
// measured but cannot move. `survived` (1 = the heart lived out the tick
// budget) carries the information that heartHits used to imply.
export const COMPARE_METRICS: readonly string[] = [
  'survivedFor',
  'survived',
  'kills',
  'playerKillShare',
  'towerKillShare',
  'peakConcurrent',
  'ttkMean',
  'waveClearMean',
];

export type Delta = { key: string; a: number; b: number; delta: number };

export function diffPresets(a: string, b: string): Array<{ key: string; a: string; b: string }> {
  const pa = toMap(a);
  const pb = toMap(b);
  const out: Array<{ key: string; a: string; b: string }> = [];
  for (const key of new Set([...pa.keys(), ...pb.keys()])) {
    const va = pa.get(key) ?? '—';
    const vb = pb.get(key) ?? '—';
    if (va !== vb) out.push({ key, a: va, b: vb });
  }
  return out;
}

function toMap(preset: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const pair of preset.split(';')) {
    const i = pair.indexOf('=');
    if (i === -1) continue;
    m.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return m;
}

export function diffSummaries(
  a: Record<string, number>,
  b: Record<string, number>,
  keys: readonly string[],
): Delta[] {
  return keys.map((key) => {
    const av = a[key] ?? 0;
    const bv = b[key] ?? 0;
    return { key, a: av, b: bv, delta: bv - av };
  });
}

export function makeCompare(tuning: TuningStore): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'admin-compare';

  let presetA: string | null = null;
  const status = document.createElement('div');
  status.className = 'admin-note';
  status.textContent = 'Set A, change levers, then Compare.';
  const table = document.createElement('div');
  table.className = 'cmp-table';

  const setA = button('set A = current', () => {
    presetA = tuning.export();
    status.textContent = 'A captured. Change levers, then run Compare.';
  });

  const run = button('compare A → B', () => {
    if (presetA === null) { status.textContent = 'Set A first.'; return; }
    const a = presetA;
    const b = tuning.export();
    status.textContent = `running ${COMPARE_SEEDS.length * 2} headless runs…`;
    Promise.all([runSet(a), runSet(b)])
      .then(([ra, rb]) => {
        render(a, b, meanSummaries(ra), meanSummaries(rb));
        status.textContent =
          `Mean of ${COMPARE_SEEDS.length} seeds, each truncated at heart death. ` +
          `Not a single-run truth: critters share one RNG stream, so survivor ` +
          `composition shifts between settings — treat small deltas as noise.`;
      })
      .catch((err: unknown) => { status.textContent = `compare failed: ${String(err)}`; });
  });

  function render(a: string, b: string, sa: Record<string, number>, sb: Record<string, number>): void {
    const levers = diffPresets(a, b);
    if (levers.length === 0) {
      table.innerHTML = `<div class="admin-note">A and B are identical — nothing to compare.</div>`;
      return;
    }
    const rows = diffSummaries(sa, sb, COMPARE_METRICS);
    table.innerHTML =
      `<div class="cmp-h">lever</div><div class="cmp-h">A</div><div class="cmp-h">B</div>` +
      levers.map((l) => `<div>${l.key}</div><div>${l.a}</div><div>${l.b}</div>`).join('') +
      `<div class="cmp-h">metric</div><div class="cmp-h">A</div><div class="cmp-h">B · Δ</div>` +
      rows.map((r) => {
        const arrow = r.delta > 0 ? '▲' : r.delta < 0 ? '▼' : '';
        return `<div>${r.key}</div><div>${fmt(r.a)}</div>` +
          `<div>${fmt(r.b)} <span class="cmp-d">${sign(r.delta)} ${arrow}</span></div>`;
      }).join('');
  }

  el.append(setA, run, status, table);
  return { el };
}

async function runSet(preset: string): Promise<RunResult[]> {
  const specs: RunSpec[] = COMPARE_SEEDS.map((seed) => ({
    seed,
    preset,
    maxTicks: 6000,
    input: 'patrol',
    towers: 'heart',
    stopAtDeath: true,
  }));
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<RunResult[]>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ results: RunResult[] }>) => resolve(e.data.results);
      worker.onerror = (e) => reject(new Error(e.message));
      worker.postMessage({ id: 1, specs });
    });
  } finally {
    worker.terminate();
  }
}

function fmt(v: number): string {
  return Math.abs(v) >= 100 || Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2);
}
function sign(v: number): string {
  return (v > 0 ? '+' : '') + fmt(v);
}
function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
