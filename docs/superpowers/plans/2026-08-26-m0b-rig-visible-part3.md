# M0b — Part 3 · HUD, Admin Mode, Acceptance (Tasks 9–13)

> Continues `2026-08-26-m0b-rig-visible.md` (Global Constraints) and `-part2.md`.

**The governing constraint for Tasks 10–13:** the dashboard is **Admin Mode** — an internal tool for finding a compelling set of values. *None of it ships to end users.* Spec §6's "mobile-legible (the operator plays on a phone)" describes where the tool is used, not a player-facing surface. So: density over discoverability, no onboarding, no aesthetic budget, and `src/ui/admin/` stays a leaf that nothing in `core/` or `render/` imports.

---

### Task 9: `src/ui/hud.ts` — the player-facing surface

**Files:**
- Create: `src/ui/hud.ts`
- Modify: `src/main.ts`, `src/style.css`

**Interfaces:**
- Produces:
  ```ts
  export type Hud = { sync(world: World): void; showRunOver(summary: Record<string, number>): void };
  export function makeHud(root: HTMLElement): Hud;
  ```

**Background:** this is the *only* UI a player sees — heart HP, wave number, enemies alive, and a run-over card. Everything else in `src/ui/` is behind the admin gate. Keep it to those four things; anything more is Admin Mode leaking into the game.

DOM writes are throttled to changed values only. Setting `textContent` every frame on every field forces layout 60×/s for numbers that change once a second, and on a phone that competes with the bloom chain for the frame budget.

- [ ] **Step 1: Write `src/ui/hud.ts`**

```ts
// hud.ts — the player-facing HUD. The ONLY UI a non-admin session shows.
//
// Four things: heart HP, wave, enemies alive, and a run-over card. Anything
// more is Admin Mode leaking into the game.
//
// Writes are diffed against the last value. Setting textContent every frame
// forces layout 60x/s for numbers that change about once a second, and on a
// phone that competes directly with the bloom chain for the frame budget.

import type { World } from '../core/sim/world.ts';

export type Hud = {
  sync(world: World): void;
  showRunOver(summary: Record<string, number>): void;
};

export function makeHud(root: HTMLElement): Hud {
  const el = document.createElement('div');
  el.className = 'hud';
  el.innerHTML = `
    <span class="hud-heart">heart <b data-f="heart">20</b>/20</span>
    <span class="hud-wave">wave <b data-f="wave">0</b></span>
    <span class="hud-alive"><b data-f="alive">0</b> alive</span>`;
  root.appendChild(el);

  const over = document.createElement('div');
  over.className = 'runover';
  over.hidden = true;
  root.appendChild(over);

  const fields = new Map<string, HTMLElement>();
  for (const node of Array.from(el.querySelectorAll<HTMLElement>('[data-f]'))) {
    fields.set(node.dataset['f']!, node);
  }
  const last = new Map<string, string>();

  function set(name: string, value: string): void {
    if (last.get(name) === value) return;
    last.set(name, value);
    const node = fields.get(name);
    if (node) node.textContent = value;
  }

  return {
    sync(world) {
      set('heart', String(Math.max(0, world.heartHp)));
      set('wave', String(world.waves.wave));
      set('alive', String(world.critters.filter((c) => c.alive).length));
    },
    showRunOver(summary) {
      if (!over.hidden) return;
      over.hidden = false;
      const survived = (summary['survivedFor'] ?? 0).toFixed(1);
      const kills = summary['kills'] ?? 0;
      over.innerHTML =
        `<h2>run over</h2><p>survived ${survived}s · ${kills} kills</p><p class="sub">reload to run again</p>`;
    },
  };
}
```

**Note for the implementer:** confirm the wave-number field on `WaveEngine` before running — `src/core/sim/waves.ts:41` declares the `WaveEngine` type. If the current wave is exposed under a different name than `wave`, use that name and keep the rest identical.

- [ ] **Step 2: Add HUD styles to `src/style.css`**

```css
.hud {
  position: fixed; top: 0; left: 0; right: 0;
  display: flex; gap: 14px; justify-content: center;
  padding: 8px 12px; pointer-events: none;
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #9fb3d9; text-shadow: 0 0 6px #05070c;
}
.hud b { color: #e6edfb; }
.runover {
  position: fixed; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 4px;
  background: rgba(5, 7, 12, 0.82); color: #e6edfb; pointer-events: none;
  font: 14px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.runover h2 { margin: 0; font-size: 22px; letter-spacing: 2px; }
.runover .sub { color: #6b7ea3; }
```

- [ ] **Step 3: Wire into `main.ts`**

Add the import and construction:

```ts
import { makeHud } from './ui/hud.ts';

const app = document.querySelector<HTMLElement>('#app')!;
const hud = makeHud(app);
```

Inside `frame()`, after `units.sync(world);`:

```ts
  hud.sync(world);
  if (loop.halted) hud.showRunOver(world.telemetry.summary());
```

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npm run dev`
Expected: a HUD strip at the top counting down heart HP; when the heart dies, a "run over" card with survival time and kills.

```bash
./scripts/bust.sh --quiet
git add src/ui/hud.ts src/main.ts src/style.css index.html
git commit -F - <<'EOF'
feat(ui): player HUD — heart, wave, enemies alive, run-over card

The only UI a non-admin session shows. Deliberately four fields: anything
more is Admin Mode leaking into the game, and the tuning dashboard is
internal tooling that never ships to players.

Writes are diffed against the last value. Setting textContent every frame
forces layout 60x/s for numbers that change about once a second, which on a
phone competes directly with the bloom chain for the frame budget.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TsYtSYBUchM2TAbNFgQo1
EOF
```

---

### Task 10: `ui/admin/gate.ts` + `dashboard.ts` — the schema-driven panel

**Files:**
- Create: `src/ui/admin/gate.ts`
- Create: `src/ui/admin/dashboard.ts`
- Test: `src/ui/admin/gate.test.ts`
- Modify: `src/main.ts`, `src/style.css`

**Interfaces:**
- Produces:
  ```ts
  // gate.ts
  export function shouldOpenAdmin(search: string, stored: string | null): boolean;
  export function nextAdminStorage(search: string, stored: string | null): string | null;
  export type Gate = { isOpen(): boolean; onOpen(fn: () => void): void };
  export function installGate(root: HTMLElement): Gate;
  // dashboard.ts
  export type Dashboard = { toggle(): void; el: HTMLElement };
  export function makeDashboard(tuning: TuningStore, root: HTMLElement): Dashboard;
  ```

**Background:**

Admin code ships in **every** build but is unreachable without deliberate entry: `?admin=1`, five taps on the top-left corner, or the `` ` `` key. Entry persists in `localStorage['ttd.admin']`; `?admin=0` exits.

Build-time stripping was considered and rejected: the phone loads the deployed GitHub Pages build, so stripping admin would remove the rig from exactly the device it is used on. The trade — a determined visitor could find the panel — costs nothing for this game.

The five-tap corner exists because a phone has no backtick key and typing a URL parameter on a phone is miserable.

The panel renders **entirely from `LEVERS`**. A new lever must be one schema entry with no UI edit; if the dashboard needs touching to add a lever, the schema has stopped being the single source of truth (spec §4).

The gate's URL/storage decision logic is pulled out as pure functions so it is Node-testable without a DOM.

- [ ] **Step 1: Write the failing test**

Create `src/ui/admin/gate.test.ts`:

```ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldOpenAdmin, nextAdminStorage } from './gate.ts';

describe('admin gate resolution', () => {
  test('closed by default', () => {
    assert.equal(shouldOpenAdmin('', null), false);
  });

  test('?admin=1 opens it', () => {
    assert.equal(shouldOpenAdmin('?admin=1', null), true);
  });

  test('a stored flag keeps it open across reloads', () => {
    assert.equal(shouldOpenAdmin('', '1'), true);
  });

  test('?admin=0 overrides a stored flag', () => {
    assert.equal(shouldOpenAdmin('?admin=0', '1'), false);
  });

  test('?admin=1 persists; ?admin=0 clears', () => {
    assert.equal(nextAdminStorage('?admin=1', null), '1');
    assert.equal(nextAdminStorage('?admin=0', '1'), null);
  });

  test('an absent param leaves storage untouched', () => {
    assert.equal(nextAdminStorage('', '1'), '1');
    assert.equal(nextAdminStorage('', null), null);
  });

  test('other params are ignored', () => {
    assert.equal(shouldOpenAdmin('?preset=enemy.speed%3D2', null), false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test src/ui/admin/gate.test.ts 2>&1 | tail -20`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `gate.ts`**

```ts
// gate.ts — the Admin Mode door.
//
// The tuning rig is internal tooling: sliders, telemetry, god toggles and
// presets exist so we can find a compelling set of values, and none of it is
// part of the base game. So it must be GATED, not merely collapsed.
//
// WHY THE CODE STILL SHIPS. Build-time stripping was rejected: the phone loads
// the deployed Pages build, so stripping admin would remove the rig from
// exactly the device it is used on. Every build carries the code with the door
// closed. A determined visitor could find it; for this game that costs nothing.
//
// THREE WAYS IN, because there are two kinds of session:
//   ?admin=1     typed once, persists
//   backtick     desktop, instant
//   5-tap corner phones have no backtick key, and typing a URL param on a
//                phone is miserable
//
// The URL/storage logic is pure so it is Node-tested without a DOM.

const KEY = 'ttd.admin';
const TAPS_REQUIRED = 5;
const TAP_WINDOW_MS = 1500;
const CORNER_PX = 64;

function param(search: string): string | null {
  const m = /[?&]admin=([^&]*)/.exec(search);
  return m ? decodeURIComponent(m[1]!) : null;
}

/** Should the panel be available this session? */
export function shouldOpenAdmin(search: string, stored: string | null): boolean {
  const p = param(search);
  if (p === '1') return true;
  if (p === '0') return false;
  return stored === '1';
}

/** What localStorage should hold after this load. An absent param leaves it
 *  untouched, so a normal reload does not silently revoke access. */
export function nextAdminStorage(search: string, stored: string | null): string | null {
  const p = param(search);
  if (p === '1') return '1';
  if (p === '0') return null;
  return stored;
}

export type Gate = { isOpen(): boolean; onOpen(fn: () => void): void };

export function installGate(root: HTMLElement): Gate {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    // Private mode or blocked storage: fall back to URL-only access.
  }

  let open = shouldOpenAdmin(window.location.search, stored);
  const next = nextAdminStorage(window.location.search, stored);
  try {
    if (next === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch { /* ignore */ }

  const listeners: Array<() => void> = [];
  function unlock(): void {
    if (open) return;
    open = true;
    try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
    for (const fn of listeners) fn();
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') unlock();
  });

  let taps = 0;
  let firstTapAt = 0;
  root.addEventListener('pointerdown', (e) => {
    if (e.clientX > CORNER_PX || e.clientY > CORNER_PX) return;
    const now = e.timeStamp;
    if (now - firstTapAt > TAP_WINDOW_MS) { taps = 0; firstTapAt = now; }
    if (++taps >= TAPS_REQUIRED) { taps = 0; unlock(); }
  });

  return {
    isOpen: () => open,
    onOpen: (fn) => { listeners.push(fn); if (open) fn(); },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test src/ui/admin/gate.test.ts 2>&1 | tail -20`
Expected: PASS, 7 tests.

- [ ] **Step 5: Implement `dashboard.ts`**

```ts
// dashboard.ts — the tuning panel, rendered entirely from LEVERS.
//
// SPEC §4 IS THE RULE HERE: one declarative schema is the single source of
// truth, and a new lever is ONE entry, not four edits. If adding a lever ever
// requires touching this file, the schema has stopped being authoritative.
// Nothing below names a specific lever.
//
// This is a TOOL, not a game surface. Density over discoverability: no
// onboarding, no animation, no aesthetic budget. It is a fullscreen modal so
// 28 levers fit on a phone without scrolling into a sliver.
//
// LIVENESS: every write goes through tuning.set(), and systems already read
// tuning.get() inside their tick — so liveness is inherited, not
// re-implemented. There is no apply button by design.

import type { TuningStore, Lever, LeverGroup } from '../../core/tuning/store.ts';
import { LEVERS } from '../../core/tuning/store.ts';

const GROUP_ORDER: LeverGroup[] = ['intensity', 'critters', 'player', 'feel', 'camera', 'god'];
const OPEN_KEY = 'ttd.admin.open';

export type Dashboard = { toggle(): void; el: HTMLElement };

export function makeDashboard(tuning: TuningStore, root: HTMLElement): Dashboard {
  const el = document.createElement('div');
  el.className = 'admin';
  el.hidden = true;

  const head = document.createElement('div');
  head.className = 'admin-head';
  head.innerHTML = `<b>ADMIN · tuning</b>`;
  const resetAll = button('reset all', () => tuning.reset());
  const close = button('close', () => toggle());
  head.append(resetAll, close);
  el.appendChild(head);

  const body = document.createElement('div');
  body.className = 'admin-body';
  el.appendChild(body);

  // Refresh handles: rebuilding the DOM on every change would drop focus
  // mid-drag, so each lever keeps its own updater and we push values in.
  const refreshers: Array<() => void> = [];

  for (const group of GROUP_ORDER) {
    const levers = LEVERS.filter((l) => l.group === group);
    if (levers.length === 0) continue;

    const section = document.createElement('details');
    section.className = 'admin-group';
    section.open = group === 'intensity';

    const summary = document.createElement('summary');
    summary.textContent = `${group} (${levers.length})`;
    section.appendChild(summary);

    const reset = button('reset', (e) => { e.stopPropagation(); tuning.reset(group); });
    reset.className = 'admin-mini';
    summary.appendChild(reset);

    for (const lever of levers) section.appendChild(row(lever));
    body.appendChild(section);
  }

  function row(lever: Lever): HTMLElement {
    const isBool = lever.min === 0 && lever.max === 1 && lever.step === 1;
    const wrap = document.createElement('label');
    wrap.className = 'admin-row';
    wrap.title = lever.help;

    const name = document.createElement('span');
    name.className = 'admin-name';
    name.textContent = lever.label;

    const value = document.createElement('span');
    value.className = 'admin-value';

    const control = document.createElement('input');
    if (isBool) {
      control.type = 'checkbox';
      control.checked = tuning.flag(lever.key);
      control.addEventListener('change', () => tuning.set(lever.key, control.checked ? 1 : 0));
    } else {
      control.type = 'range';
      control.min = String(lever.min);
      control.max = String(lever.max);
      control.step = String(lever.step);
      control.value = String(tuning.get(lever.key));
      control.addEventListener('input', () => tuning.set(lever.key, Number(control.value)));
    }

    function refresh(): void {
      const v = tuning.get(lever.key);
      if (isBool) control.checked = v !== 0;
      else if (document.activeElement !== control) control.value = String(v);
      value.textContent = isBool ? (v !== 0 ? 'on' : 'off') : formatValue(v, lever.step);
    }
    refresh();
    refreshers.push(refresh);

    wrap.append(name, control, value);
    return wrap;
  }

  // The store is the single source of truth, so a change from ANY source
  // (preset import, ?preset=, reset) repaints the panel.
  tuning.onChange(() => { for (const fn of refreshers) fn(); });

  root.appendChild(el);

  function toggle(): void {
    el.hidden = !el.hidden;
    try { localStorage.setItem(OPEN_KEY, el.hidden ? '0' : '1'); } catch { /* ignore */ }
  }

  try {
    if (localStorage.getItem(OPEN_KEY) === '1') el.hidden = false;
  } catch { /* ignore */ }

  return { toggle, el };
}

function formatValue(v: number, step: number): string {
  const decimals = step >= 1 ? 0 : String(step).split('.')[1]?.length ?? 2;
  return v.toFixed(decimals);
}

function button(label: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
```

- [ ] **Step 6: Add admin styles to `src/style.css`**

```css
.admin {
  position: fixed; inset: 0; z-index: 20;
  display: flex; flex-direction: column;
  background: rgba(6, 9, 16, 0.96); color: #9fb3d9;
  font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.admin-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-bottom: 1px solid #22304d; color: #e6edfb;
}
.admin-head b { flex: 1; letter-spacing: 1px; }
.admin-body { flex: 1; overflow-y: auto; padding: 6px 10px 40px; }
.admin-group { border-bottom: 1px solid #16203a; padding: 4px 0; }
.admin-group > summary {
  cursor: pointer; color: #cfe0ff; padding: 4px 0;
  display: flex; align-items: center; gap: 8px; letter-spacing: 1px;
}
.admin-row {
  display: grid; grid-template-columns: 1fr 1.3fr 52px;
  align-items: center; gap: 8px; padding: 3px 0 3px 10px;
}
.admin-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.admin-value { text-align: right; color: #5aa0ff; }
.admin input[type="range"] { width: 100%; accent-color: #5aa0ff; }
.admin button {
  background: #16203a; color: #cfe0ff; border: 1px solid #2f3d5c;
  border-radius: 3px; padding: 3px 8px; font: inherit; cursor: pointer;
}
.admin-mini { margin-left: auto; padding: 1px 6px; }
```

- [ ] **Step 7: Wire into `main.ts`**

```ts
import { installGate } from './ui/admin/gate.ts';
import { makeDashboard } from './ui/admin/dashboard.ts';

const gate = installGate(app);
gate.onOpen(() => {
  const dash = makeDashboard(tuning, app);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') dash.toggle();
  });
});
```

- [ ] **Step 8: Verify and commit**

Run: `npm run typecheck && npm test 2>&1 | tail -5`

Run: `npm run dev`, then open the URL with `?admin=1`.
Expected: a fullscreen panel with six collapsible groups covering all 28 levers. Drag `enemy.speed` — critters visibly retime **without a reload**. Close with `` ` ``. Reload the plain URL — the panel is still reachable (stored flag); reload with `?admin=0` — the door is shut.

```bash
./scripts/bust.sh --quiet
git add src/ui/admin/ src/main.ts src/style.css index.html
git commit -F - <<'EOF'
feat(admin): gated schema-driven tuning dashboard

The rig is internal tooling — sliders, god toggles and telemetry exist so we
can find a compelling set of values, and none of it is part of the base
game. So it is gated rather than merely collapsed.

Build-time stripping was rejected: the phone loads the deployed Pages
build, so stripping admin would remove the rig from exactly the device it
gets used on. Every build ships the code with the door closed. Three ways
in, because there are two kinds of session — ?admin=1 persists, backtick is
instant on desktop, and a five-tap corner exists because phones have no
backtick key and typing a URL param on a phone is miserable.

The panel renders entirely from LEVERS and names no lever anywhere: spec §4
says a new lever is one schema entry, so if adding one ever required
touching the dashboard, the schema would have stopped being authoritative.

No apply button by design — writes go through tuning.set() and systems
already read tuning.get() inside their tick, so liveness is inherited
rather than re-implemented. Rows refresh in place rather than rebuilding,
which would drop focus mid-drag.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TsYtSYBUchM2TAbNFgQo1
EOF
```

---

### Task 11: `ui/admin/presets.ts` — save, load, export, import, URL

**Files:**
- Create: `src/ui/admin/presets.ts`
- Test: `src/ui/admin/presets.test.ts`
- Modify: `src/ui/admin/dashboard.ts`, `src/main.ts`

**Interfaces:**
```ts
export type PresetBook = Record<string, string>;
export function parsePresetParam(search: string): string | null;
export function readBook(raw: string | null): PresetBook;
export function writeBook(book: PresetBook): string;
export function savePreset(book: PresetBook, name: string, preset: string): PresetBook;
export function deletePreset(book: PresetBook, name: string): PresetBook;
export type Presets = { el: HTMLElement };
export function makePresets(tuning: TuningStore): Presets;
```

**Background:** spec §9 point 6 — *a preset round-trips: save → reload the page → identical behaviour; export → import → identical.* `tuning.export()` already produces `key=value;key=value` and `tuning.import()` already ignores unknown keys for forward compatibility, so this task is storage and UI around an existing, tested core capability — **do not reimplement serialisation here.**

The pure functions are separated from the DOM so the round-trip is Node-tested. A corrupt `localStorage` value must not brick the panel: `readBook` returns `{}` rather than throwing.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePresetParam, readBook, writeBook, savePreset, deletePreset } from './presets.ts';
import { makeTuning } from '../../core/tuning/store.ts';

describe('preset URL param', () => {
  test('absent yields null', () => {
    assert.equal(parsePresetParam(''), null);
    assert.equal(parsePresetParam('?admin=1'), null);
  });
  test('decodes a URL-encoded preset', () => {
    assert.equal(parsePresetParam('?preset=enemy.speed%3D2%3Bwave.gap%3D3'), 'enemy.speed=2;wave.gap=3');
  });
});

describe('preset book storage', () => {
  test('a missing or corrupt store yields an empty book rather than throwing', () => {
    assert.deepEqual(readBook(null), {});
    assert.deepEqual(readBook('not json at all'), {});
    assert.deepEqual(readBook('[1,2,3]'), {}, 'a non-object JSON value must not become a book');
  });
  test('save then read round-trips', () => {
    const book = savePreset({}, 'brutal', 'enemy.speed=2.5');
    assert.deepEqual(readBook(writeBook(book)), { brutal: 'enemy.speed=2.5' });
  });
  test('saving the same name overwrites', () => {
    const b = savePreset(savePreset({}, 'a', 'x=1'), 'a', 'x=2');
    assert.deepEqual(b, { a: 'x=2' });
  });
  test('delete removes one entry and leaves the rest', () => {
    const b = savePreset(savePreset({}, 'a', 'x=1'), 'b', 'y=2');
    assert.deepEqual(deletePreset(b, 'a'), { b: 'y=2' });
  });
});

describe('preset round-trip through the tuning store', () => {
  test('export then import restores every value', () => {
    const a = makeTuning();
    a.set('enemy.speed', 2.5);
    a.set('wave.gap', 3);
    a.set('god.heartInvulnerable', 1);
    const b = makeTuning();
    b.import(a.export());
    assert.equal(b.export(), a.export());
  });

  test('an unknown key is ignored rather than throwing', () => {
    const t = makeTuning();
    const before = t.export();
    t.import('not.a.lever=9;enemy.speed=1.5');
    assert.equal(t.get('enemy.speed'), 1.5);
    assert.notEqual(t.export(), before);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `node --test src/ui/admin/presets.test.ts` → module not found.

- [ ] **Step 3: Implement `presets.ts`**

```ts
// presets.ts — named presets, an export string, and ?preset= on the URL.
//
// Spec §9.6: a preset must round-trip — save, reload the page, identical
// behaviour; export, import, identical. tuning.export() already produces
// 'key=value;key=value' and tuning.import() already ignores unknown keys for
// forward compatibility, both tested in core. This module is storage and UI
// around that; it does NOT reimplement serialisation.
//
// A corrupt localStorage value must not brick the panel — readBook returns an
// empty book rather than throwing, because losing saved presets is annoying
// and losing the whole rig is not acceptable.

import type { TuningStore } from '../../core/tuning/store.ts';

const BOOK_KEY = 'ttd.presets';

export type PresetBook = Record<string, string>;

export function parsePresetParam(search: string): string | null {
  const m = /[?&]preset=([^&]*)/.exec(search);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function readBook(raw: string | null): PresetBook {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: PresetBook = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeBook(book: PresetBook): string {
  return JSON.stringify(book);
}

export function savePreset(book: PresetBook, name: string, preset: string): PresetBook {
  return { ...book, [name]: preset };
}

export function deletePreset(book: PresetBook, name: string): PresetBook {
  const out = { ...book };
  delete out[name];
  return out;
}

export type Presets = { el: HTMLElement };

export function makePresets(tuning: TuningStore): Presets {
  const el = document.createElement('div');
  el.className = 'admin-presets';

  const select = document.createElement('select');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'preset name';
  const exportBox = document.createElement('textarea');
  exportBox.rows = 2;
  exportBox.spellcheck = false;

  function load(): PresetBook {
    try { return readBook(localStorage.getItem(BOOK_KEY)); } catch { return {}; }
  }
  function store(book: PresetBook): void {
    try { localStorage.setItem(BOOK_KEY, writeBook(book)); } catch { /* ignore */ }
    repaint(book);
  }
  function repaint(book: PresetBook): void {
    select.innerHTML = '';
    for (const name of Object.keys(book).sort()) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    }
  }

  const save = btn('save', () => {
    const name = nameInput.value.trim();
    if (name === '') return;
    store(savePreset(load(), name, tuning.export()));
  });
  const apply = btn('load', () => {
    const preset = load()[select.value];
    if (preset !== undefined) tuning.import(preset);
  });
  const del = btn('delete', () => store(deletePreset(load(), select.value)));
  const copy = btn('export →', () => { exportBox.value = tuning.export(); exportBox.select(); });
  const paste = btn('← import', () => tuning.import(exportBox.value.trim()));

  el.append(nameInput, save, select, apply, del, exportBox, copy, paste);
  repaint(load());
  return { el };
}

function btn(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
```

- [ ] **Step 4: Run to verify it passes.** Expected: PASS, 8 tests.

- [ ] **Step 5: Mount presets in the dashboard**

In `dashboard.ts`, add `import { makePresets } from './presets.ts';` and insert before the group loop:

```ts
  body.appendChild(makePresets(tuning).el);
```

Add to `style.css`:

```css
.admin-presets {
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  padding: 8px 0; border-bottom: 1px solid #22304d;
}
.admin-presets input[type="text"], .admin-presets select {
  background: #0d1424; color: #cfe0ff; border: 1px solid #2f3d5c;
  border-radius: 3px; padding: 3px 6px; font: inherit;
}
.admin-presets textarea {
  flex: 1 1 100%; background: #0d1424; color: #7ee0a8;
  border: 1px solid #2f3d5c; border-radius: 3px; font: inherit; padding: 4px 6px;
}
```

- [ ] **Step 6: Apply `?preset=` at boot in `main.ts`**

Immediately after `const tuning = makeTuning();` — **before `makeWorld`**, so the first tick already sees the preset:

```ts
import { parsePresetParam } from './ui/admin/presets.ts';

const urlPreset = parsePresetParam(window.location.search);
if (urlPreset !== null) tuning.import(urlPreset);
```

- [ ] **Step 7: Verify the round-trip by hand, then commit**

Run `npm run dev`, open `?admin=1`, change `enemy.speed`, save as `test`, reload, load `test` — the slider returns to the saved value. Then `export →`, reload, paste, `← import` — identical.

Also check `?admin=1&preset=enemy.speed%3D3` boots with speed at 3.

```bash
./scripts/bust.sh --quiet
git add src/ui/admin/presets.ts src/ui/admin/presets.test.ts src/ui/admin/dashboard.ts src/main.ts src/style.css index.html
git commit -F - <<'EOF'
feat(admin): named presets, export string, and ?preset= at boot

Spec §9.6 wants a preset to round-trip: save, reload, identical; export,
import, identical. tuning.export()/import() already do the serialisation and
already ignore unknown keys for forward compatibility, both tested in core —
so this is storage and UI around an existing capability rather than a second
implementation of it.

readBook returns an empty book on corrupt or non-object JSON rather than
throwing: losing saved presets is annoying, losing the whole rig is not
acceptable.

?preset= is applied before makeWorld so the first tick already sees it —
applying it after construction would leave one tick of default tuning in
every shared link's telemetry.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TsYtSYBUchM2TAbNFgQo1
EOF
```

---

### Task 12: `ui/admin/telemetry.ts` + `compare.ts` + `worker.ts` — adjudication

**Files:**
- Create: `src/ui/admin/telemetry.ts`
- Create: `src/ui/admin/worker.ts`
- Create: `src/ui/admin/compare.ts`
- Test: `src/ui/admin/compare.test.ts`
- Modify: `src/ui/admin/dashboard.ts`, `src/main.ts`

**Interfaces:**
```ts
// telemetry.ts
export type TelemetryView = { el: HTMLElement; sync(world: World): void };
export function makeTelemetryView(): TelemetryView;
// compare.ts
export type Delta = { key: string; a: number; b: number; delta: number };
export function diffPresets(a: string, b: string): Array<{ key: string; a: string; b: string }>;
export function diffSummaries(a: Record<string, number>, b: Record<string, number>, keys: readonly string[]): Delta[];
export const COMPARE_METRICS: readonly string[];
export const COMPARE_SEEDS: readonly number[];
export function makeCompare(tuning: TuningStore): { el: HTMLElement };
```

**Background:**

Spec §9 point 8 is *the real acceptance criterion*: **"you can run a tuning session and say which of two settings was better and why, citing a number."**

Comparing two *played* sessions cannot do that — two runs differ in how the tank was driven as much as in the lever under test, and that is precisely the noise the sweep exists to avoid. So Compare runs `runHeadless` (Task 2) in a **Web Worker** across seeds 42/43/44 and reports the mean. `core/` is pure TypeScript already in the bundle, so the worker needs no three.js.

**Carry M0a's comparability hazard forward honestly:** all critters share one RNG stream, so changing a combat lever changes survivor composition and shifts every later critter's envelope draws. Multi-seed averaging is a *mitigation, not a fix* — the UI must label results as a three-seed mean, never a single-run truth.

`RunSpec` was designed as plain data in Task 2 precisely so it survives `structuredClone` to the worker.

- [ ] **Step 1: Write the failing test for the pure parts**

```ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { diffPresets, diffSummaries, COMPARE_METRICS, COMPARE_SEEDS } from './compare.ts';

describe('preset diff', () => {
  test('reports only the keys that differ', () => {
    const d = diffPresets('enemy.speed=1;wave.gap=8', 'enemy.speed=2;wave.gap=8');
    assert.deepEqual(d, [{ key: 'enemy.speed', a: '1', b: '2' }]);
  });
  test('identical presets produce no rows', () => {
    assert.deepEqual(diffPresets('a=1;b=2', 'a=1;b=2'), []);
  });
  test('a key present on one side only is reported', () => {
    assert.deepEqual(diffPresets('a=1', 'a=1;b=2'), [{ key: 'b', a: '—', b: '2' }]);
  });
});

describe('summary diff', () => {
  test('computes b - a for the requested metrics only', () => {
    const d = diffSummaries({ x: 10, y: 1 }, { x: 25, y: 9 }, ['x']);
    assert.deepEqual(d, [{ key: 'x', a: 10, b: 25, delta: 15 }]);
  });
  test('a metric missing from a summary reads as 0 rather than NaN', () => {
    const d = diffSummaries({}, { x: 4 }, ['x']);
    assert.equal(d[0]!.delta, 4);
    assert.ok(!Number.isNaN(d[0]!.a));
  });
});

describe('compare configuration', () => {
  test('uses at least three seeds — one seed is not evidence', () => {
    assert.ok(COMPARE_SEEDS.length >= 3);
    assert.equal(new Set(COMPARE_SEEDS).size, COMPARE_SEEDS.length, 'duplicate seeds inflate confidence');
  });
  test('survivedFor is reported — it is the cleanest difficulty signal', () => {
    assert.ok(COMPARE_METRICS.includes('survivedFor'));
    assert.ok(COMPARE_METRICS.includes('playerKillShare'));
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement `worker.ts`**

```ts
// worker.ts — runs headless sims off the main thread.
//
// core/ is pure TypeScript with no three.js, so it runs unchanged in a worker.
// That is the payoff of the M0a seam: the brain is portable to any host that
// can run JS, and the compare feature gets real numbers without dropping the
// render loop below frame rate.

import { runHeadless } from '../../core/sim/runner.ts';
import type { RunSpec, RunResult } from '../../core/sim/runner.ts';

export type CompareRequest = { id: number; specs: RunSpec[] };
export type CompareResponse = { id: number; results: RunResult[] };

self.onmessage = (e: MessageEvent<CompareRequest>) => {
  const { id, specs } = e.data;
  const results = specs.map((s) => runHeadless(s));
  const msg: CompareResponse = { id, results };
  (self as unknown as Worker).postMessage(msg);
};
```

- [ ] **Step 4: Implement `compare.ts`**

```ts
// compare.ts — the A/B adjudicator. Spec §9.8 is the real acceptance criterion:
// "run a tuning session and say which of two settings was better, citing a
// number."
//
// WHY HEADLESS, NOT SNAPSHOTS OF PLAYED RUNS. Two played sessions differ in how
// the tank was driven as much as in the lever under test — exactly the noise
// the sweep exists to avoid. Compare runs the pure sim instead, with identical
// scripted input on both sides, so the lever really is the only difference.
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
export const COMPARE_METRICS: readonly string[] = [
  'survivedFor',
  'heartHits',
  'kills',
  'playerKillShare',
  'peakConcurrent',
  'ttkMean',
  'waveClearMean',
  'macroShare',
];

export type Delta = { key: string; a: number; b: number; delta: number };

export function diffPresets(a: string, b: string): Array<{ key: string; a: string; b: string }> {
  const pa = toMap(a);
  const pb = toMap(b);
  const keys = new Set([...pa.keys(), ...pb.keys()]);
  const out: Array<{ key: string; a: string; b: string }> = [];
  for (const key of keys) {
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
  const table = document.createElement('div');

  const setA = btn('set A = current', () => {
    presetA = tuning.export();
    status.textContent = 'A captured. Change levers, then run Compare.';
  });

  const run = btn('compare A → B', async () => {
    if (presetA === null) { status.textContent = 'Set A first.'; return; }
    const presetB = tuning.export();
    status.textContent = `running ${COMPARE_SEEDS.length * 2} headless runs…`;
    try {
      const [ra, rb] = await Promise.all([runSet(presetA), runSet(presetB)]);
      render(presetA, presetB, meanSummaries(ra), meanSummaries(rb));
      status.textContent = `mean of ${COMPARE_SEEDS.length} seeds, truncated at heart death. Not a single-run truth: critters share one RNG stream, so survivor composition shifts between settings.`;
    } catch (err) {
      status.textContent = `compare failed: ${String(err)}`;
    }
  });

  function render(a: string, b: string, sa: Record<string, number>, sb: Record<string, number>): void {
    const levers = diffPresets(a, b);
    const rows = diffSummaries(sa, sb, COMPARE_METRICS);
    table.innerHTML =
      `<div class="cmp-h">lever</div><div class="cmp-h">A</div><div class="cmp-h">B</div>` +
      levers.map((l) => `<div>${l.key}</div><div>${l.a}</div><div>${l.b}</div>`).join('') +
      `<div class="cmp-h">metric</div><div class="cmp-h">A</div><div class="cmp-h">B · Δ</div>` +
      rows.map((r) => {
        const arrow = r.delta > 0 ? '▲' : r.delta < 0 ? '▼' : '';
        return `<div>${r.key}</div><div>${fmt(r.a)}</div><div>${fmt(r.b)} <span class="cmp-d">${sign(r.delta)} ${arrow}</span></div>`;
      }).join('');
    if (levers.length === 0) {
      table.innerHTML = `<div class="admin-note">A and B are identical — nothing to compare.</div>`;
    }
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
function btn(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
```

- [ ] **Step 5: Implement `telemetry.ts` (the two-pane readout)**

```ts
// telemetry.ts — the live readout, in the two panes spec §5 defines.
//
// DIFFICULTY answers "is it hard enough". LAYER BALANCE answers "is each layer
// doing its job" — and that second pane is the one vision §0 says the rig
// exists for. macroShare and modeSwitches read 0 in every M0a sweep because
// nothing ever called setMacro; the camera family switch now feeds them.

import type { World } from '../../core/sim/world.ts';

const DIFFICULTY = ['heartHits', 'tankHits', 'leaks', 'kills', 'ttkMean', 'waveClearMean', 'peakConcurrent', 'survivedFor'];
const BALANCE = ['macroShare', 'modeSwitches', 'tankIdleUnderThreat', 'decisionsTotal', 'playerKillShare', 'towerKillShare'];

export type TelemetryView = { el: HTMLElement; sync(world: World): void };

export function makeTelemetryView(): TelemetryView {
  const el = document.createElement('div');
  el.className = 'admin-tel';
  const panes: Array<{ keys: string[]; body: HTMLElement }> = [];

  for (const [title, keys] of [['difficulty', DIFFICULTY], ['layer balance', BALANCE]] as const) {
    const pane = document.createElement('div');
    pane.className = 'admin-tel-pane';
    const h = document.createElement('div');
    h.className = 'admin-tel-h';
    h.textContent = title;
    const body = document.createElement('div');
    body.className = 'admin-tel-body';
    pane.append(h, body);
    el.appendChild(pane);
    panes.push({ keys: [...keys], body });
  }

  let frame = 0;
  return {
    el,
    sync(world) {
      // 6 Hz: these are numbers a human reads, and a 60 Hz DOM rewrite of ~14
      // fields competes with the bloom chain for the frame budget on a phone.
      if (frame++ % 10 !== 0) return;
      const s = world.telemetry.summary();
      for (const pane of panes) {
        pane.body.innerHTML = pane.keys
          .map((k) => `<div>${k}</div><div class="v">${format(s[k])}</div>`)
          .join('');
      }
    },
  };
}

function format(v: number | undefined): string {
  if (v === undefined) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
```

- [ ] **Step 6: Mount both in the dashboard and sync from `main.ts`**

In `dashboard.ts`, extend the return type to `{ toggle(): void; el: HTMLElement; sync(world: World): void }`, add imports, and insert after the presets row:

```ts
  const tel = makeTelemetryView();
  body.appendChild(tel.el);
  body.appendChild(makeCompare(tuning).el);
```

Return `sync: (world) => { if (!el.hidden) tel.sync(world); }` — skipping the work entirely while the panel is closed.

In `main.ts`, keep a reference from `gate.onOpen` and call `dash.sync(world)` inside `frame()`.

Add to `style.css`:

```css
.admin-tel { display: flex; gap: 12px; flex-wrap: wrap; padding: 8px 0; border-bottom: 1px solid #22304d; }
.admin-tel-pane { flex: 1 1 200px; }
.admin-tel-h { color: #cfe0ff; letter-spacing: 1px; margin-bottom: 4px; }
.admin-tel-body { display: grid; grid-template-columns: 1fr auto; gap: 1px 10px; }
.admin-tel-body .v { color: #7ee0a8; text-align: right; }
.admin-compare { padding: 8px 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: flex-start; }
.admin-compare > div:last-child { flex: 1 1 100%; display: grid; grid-template-columns: 1.4fr 1fr 1.4fr; gap: 1px 10px; }
.admin-note { flex: 1 1 100%; color: #6b7ea3; line-height: 1.5; }
.cmp-h { color: #cfe0ff; border-bottom: 1px solid #22304d; }
.cmp-d { color: #5aa0ff; }
```

- [ ] **Step 7: Verify and commit**

Run: `npm run typecheck && npm test 2>&1 | tail -5 && npm run dev`

In the panel: telemetry updates live; press `Tab` a few times and confirm `modeSwitches` climbs and `macroShare` is non-zero — **the first time this telemetry has had data.** Then `set A = current`, change `wave.dripRate`, `compare A → B`: a delta table appears within a few seconds and the main render loop keeps running smoothly throughout (proof the worker is off-thread).

```bash
./scripts/bust.sh --quiet
git add src/ui/admin/ src/main.ts src/style.css index.html
git commit -F - <<'EOF'
feat(admin): two-pane telemetry readout and headless A/B compare

Spec §9.8 is the real acceptance criterion — say which of two settings was
better, citing a number. Snapshotting two played sessions cannot do that:
they differ in how the tank was driven as much as in the lever under test,
which is exactly the noise the sweep exists to avoid. Compare runs the pure
sim in a Web Worker with identical scripted input on both sides, so the
lever really is the only difference.

Three seeds, and the UI says so. M0a brain-notes §2: critters share one RNG
stream, so changing a combat lever shifts survivor composition and every
later envelope draw. Multi-seed averaging is a mitigation, not a fix, and
presenting a single run as truth would be the more comfortable lie.

RunSpec was designed as plain data precisely so it survives structuredClone
to the worker; core/ has no three.js, so it runs there unchanged. That
portability is the payoff of the M0a seam.

The layer-balance pane finally has data: macroShare and modeSwitches read 0
in every M0a sweep because nothing called setMacro, and the camera family
switch now feeds them.

Readout runs at 6 Hz — these are numbers a human reads, and a 60 Hz rewrite
of ~14 fields competes with the bloom chain on a phone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TsYtSYBUchM2TAbNFgQo1
EOF
```

---

### Task 13: Acceptance pass

**Files:**
- Create: `docs/04-M0b-notes.md`
- Modify: `CLAUDE.md` (the **State** section), `docs/01-M0-tuning-rig-spec.md` (§7 placement-rule note)

- [ ] **Step 1: Run the full gate**

```bash
npm run typecheck && npm test 2>&1 | tail -8 && ./scripts/verify-determinism.sh
```
Expected: typecheck silent; `fail 0`; determinism PASS.

- [ ] **Step 2: Walk spec §9's acceptance list against the running app**

Open `npm run dev` with `?admin=1` and confirm each, recording what you actually saw:

1. Board renders, dungeon tags legible.
2. Critters and towers are dot-clouds with bloom; heart dims as it takes damage.
3. All five cameras work; `Tab`/`C` switch and cycle with eased blends.
4. Tank drives and fires from keyboard **and** touch (device toolbar).
5. Towers place by click/tap; refusals are visible.
6. Every lever renders and applies live — spot-check one per group.
7. `macroShare` and `modeSwitches` are non-zero after pressing `Tab`.
8. Preset round-trips: save → reload → identical; export → import → identical.
9. Compare produces a three-seed delta table.
10. `npm test` + `npm run typecheck` green.

Also close the render-liveness residual gap **by eye**, since no test can (see `render/bindings.ts`): drag `bloom.strength` from 0 to 3 and confirm the glow actually changes; drag `shake.amount` and confirm the camera jitters on hits. Record the result — this is the one claim the binding tests deliberately do not make.

- [ ] **Step 3: Write `docs/04-M0b-notes.md`**

Follow the shape of `docs/02-M0a-brain-notes.md`. Required sections:
- **What the build revealed that the spec got wrong** — the honest section. M0a's equivalent listed seven items; do not write "nothing" without having looked.
- **First data for the layer-balance pane** — actual `macroShare` / `modeSwitches` / `tankIdleUnderThreat` numbers from a played session, with what they suggest. This telemetry has never had values before; this is its first reading.
- **The render-liveness residual gap** — what `bindings.test.ts` proves, what it does not, and the result of the by-eye check from Step 2.
- **Performance on the phone** — frame rate with bloom at peak concurrency, and whether the capacity ceilings in `units.ts` were ever hit.
- **Known-state note for tuning**, updating `CLAUDE.md`'s current one.

- [ ] **Step 4: Update `CLAUDE.md`'s State section**

Replace the **State** paragraph: M0a → M0b complete, new test count, what M0c/M1 is next. Keep the "Known state when tuning" note but refresh it with anything Step 2 or 3 changed.

- [ ] **Step 5: Correct the spec §7 placement note**

`world.ts:placeTower` carries: *"M0a placement rule: open cells only (spec §7 says 'wall cells' — flagged for M0b spec update)."* Resolve it now: either update spec §7 §to say open cells, or change the rule. **Open cells is correct** — towers on BLOCKED cells would be unreachable and unplaceable by raycast anyway. Update the spec text and delete the flag comment from `world.ts`.

- [ ] **Step 6: Commit and push**

```bash
./scripts/bust.sh --quiet
git add docs/ CLAUDE.md src/core/sim/world.ts index.html
git commit -F - <<'EOF'
docs: M0b closeout — the rig is visible

Acceptance walked against spec §9 point by point, including the by-eye
check that bindings.test.ts deliberately does not make: that three.js
honours the bloom and shake values the binding table writes.

Records the first real numbers for the layer-balance telemetry. macroShare,
modeSwitches and tankIdleUnderThreat read 0 in every M0a sweep because
nothing ever called setMacro — vision §0 calls that ratio the headline
measurement the rig exists for, and until now it had never been measured.

Resolves the placeTower flag left in world.ts: open cells is the correct
rule (a tower on a BLOCKED cell is unreachable and unplaceable by raycast),
so spec §7's "wall cells" was the error, not the code.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TsYtSYBUchM2TAbNFgQo1
EOF
git push
```

- [ ] **Step 7: Notify the operator**

```bash
source ~/.config/kainode/telegram.env
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
  -d chat_id="496805857" \
  -d text="TTD M0b complete — the rig is visible. Board renders with bloom, 5 camera modes, tank drivable on keyboard+touch, gated admin dashboard tunes every lever live, A/B compare over 3 seeds. Layer-balance telemetry has data for the first time. https://kai-denrei.github.io/TTD/"
```

---

## Self-Review

**Spec coverage.** §1 module map → Tasks 1–12 (every listed file has an owning task). §2 render → Tasks 1, 4, 6. §3.1 fixed timestep → Task 5. §3.2 cameras → Task 7. §3.3 input → Task 8. §4.1 gate → Task 10. §4.2 panel → Task 10. §4.3 presets → Task 11. §4.4 telemetry → Task 12. §5 render liveness → Task 3. §6 runner → Task 2. §7 compare → Task 12. §8 testing → tests in Tasks 1, 2, 3, 5, 7, 8, 10, 11, 12. §9 acceptance → Task 13. §10 out-of-scope items appear in no task, correctly.

**Gap found and closed:** the design's §2 table lists a heart and gate visual; `units.ts` (Task 6) draws the heart but **not** the gates. Gates are cosmetic in M0b and spawn locations are visible from where critters appear, so this is deliberately dropped rather than silently missed — noted here so Task 13's acceptance walk does not flag it as a defect.

**Type consistency checked:** `ModelPoint` (Task 1) is consumed by `points.ts` (Task 6) unchanged. `RunSpec`/`RunResult` (Task 2) are consumed by `worker.ts` and `compare.ts` (Task 12) unchanged. `RenderTarget` (Task 3) is consumed by `main.ts` (Task 4) and the rig's `shakeGain` (Task 7). `CamContext` (Task 7) is built in `main.ts` from `world.tank`. `Stepper` (Task 5) is satisfied by the inline object in `main.ts`.

**Placeholder scan:** none. Every code step carries complete code; the only judgement calls left to the implementer are Task 9's `WaveEngine` field-name confirmation (with explicit instructions) and Task 13's recorded observations, which are findings by nature and cannot be pre-written.
