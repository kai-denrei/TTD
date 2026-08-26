# M0a Telemetry Honesty Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all Important + fix-now Minor findings from the M0a milestone review so that every telemetry counter measures exactly what its name claims.

**Architecture:** Seven logical commits, each fixing a coherent group of findings. Changes touch `telemetry.ts`, `world.ts`, `critters.ts`, `grid.ts`, `store.ts`, `liveness.test.ts`, `telemetry.test.ts`, `world.test.ts`, `sweep.ts`, and `docs/02-M0a-brain-notes.md`. The `critters` dead-field removal (M13) and `grid.ts` aliasing fix (M15) are purely internal and carry no API changes. The report goes to `.superpowers/sdd/m0a-fixB-report.md`.

**Tech Stack:** TypeScript 5.x (native Node strip-types), Node 22 test runner (`node:test`), no three.js in core/.

## Global Constraints

- `src/core/` must never import three.js, call `Math.random`, or touch DOM/wall-clock.
- Levers must be read LIVE inside the tick (never captured at construction).
- `npm run typecheck` AND `npm test` must pass after every commit.
- Cross-process replay determinism must be verified after Task 6 (I9 critter pruning).
- Do NOT push. Commit locally with the exact two-line trailer:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QH1hQk64Cw4ZwpAi59Pnat
  ```
- When updating a test that encoded buggy behaviour, record which test and why in the commit message.

---

### Task 1: NEW-A — Heart death telemetry + sweep survivedFor

**Files:**
- Modify: `src/core/sim/telemetry.ts` — add `heartDeathAt`, `survived`, `survivedFor` to `Telemetry` type + `summary()`; add internal `recordHeartDeath(elapsed)` function
- Modify: `src/core/sim/world.ts` — call `telemetry.recordHeartDeath(elapsed)` at the point `heartHp` first reaches 0; expose `heartDied: boolean` getter
- Modify: `scripts/sweep.ts` — include `survivedFor` column in table output
- Modify: `src/core/sim/telemetry.test.ts` — add test asserting `heartDeathAt` is set exactly once, `survived` false, `survivedFor` < elapsed
- Modify: `src/core/sim/world.test.ts` — add test asserting death is recorded at ~t=20 for the known bad config (seed 42, one tower at heart, default tuning, 100s run)

**Interfaces:**
- Produces: `telemetry.recordHeartDeath(elapsed: number): void` — sets `heartDeathAt` once (no-op if already set)
- Produces: `summary()` now includes `heartDeathAt: number` (0 = never died), `survived: number` (1 = never died, 0 = died), `survivedFor: number` (elapsed at death, or total elapsed if never died)

- [ ] **Step 1: Add fields to `Telemetry` type in `telemetry.ts`**

In `telemetry.ts`, extend the `Telemetry` type and initialise the new fields:

```typescript
// In the Telemetry type (after line 27, add):
  heartDeathAt: number | null;  // null = still alive; set once when heartHp first hits 0
```

In `makeTelemetry()`, initialise in the `data` object after `decisionsThisPhase: 0`:
```typescript
heartDeathAt: null,
```

Add a `recordHeartDeath` function inside `makeTelemetry()`:
```typescript
function recordHeartDeath(elapsed: number): void {
  if (data.heartDeathAt === null) {
    data.heartDeathAt = elapsed;
  }
}
```

Expose it in the return:
```typescript
return { data, tick, kill, heartHit, tankHit, leak, decision, waveCleared, recordHeartDeath, summary, reset };
```

Also update `reset()` to clear it:
```typescript
data.heartDeathAt = null;
```

- [ ] **Step 2: Add `survived` and `survivedFor` to `summary()` in `telemetry.ts`**

In the `summary()` function, add after the wave clear stats:
```typescript
const survived = data.heartDeathAt === null ? 1 : 0;
const survivedFor = data.heartDeathAt !== null ? data.heartDeathAt : data.elapsed;
```

Add to the returned object:
```typescript
survived,
survivedFor,
heartDeathAt: data.heartDeathAt ?? 0,
```

- [ ] **Step 3: Update the `makeTelemetry` return type annotation**

The `makeTelemetry` return type is inferred — verify `tsc --noEmit` still passes:
```bash
cd /Users/minikai/Dev/TTD && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Wire `recordHeartDeath` in `world.ts`**

In `world.ts` step 7a, after `heartHp < 0` clamp, call death notification. Find the block starting at line 232:
```typescript
      if (!tuning.flag('god.heartInvulnerable')) {
        heartHp -= 1;
        if (heartHp < 0) heartHp = 0;
      }
```
Change to:
```typescript
      if (!tuning.flag('god.heartInvulnerable')) {
        heartHp -= 1;
        if (heartHp < 0) heartHp = 0;
        if (heartHp === 0) telemetry.recordHeartDeath(elapsed);
      }
```

Also expose a `heartDied` getter on the returned World object. In the return object, add:
```typescript
get heartDied() { return telemetry.data.heartDeathAt !== null; },
```
And add `heartDied: boolean` to the `World` type.

- [ ] **Step 5: Update `scripts/sweep.ts` to include `survivedFor`**

The sweep already spreads `w.telemetry.summary()` into rows, so `survivedFor` will appear automatically. But add a note comment above `console.table(rows)`:
```typescript
// survivedFor: elapsed when heart died (or total elapsed if survived).
// Rows where survivedFor << elapsed are measuring a dead game — compare with caution.
console.table(rows);
```

- [ ] **Step 6: Write failing tests**

In `telemetry.test.ts`, add:
```typescript
test('heartDeathAt is set exactly once when heart dies', () => {
  const t = makeTelemetry();
  assert.equal(t.data.heartDeathAt, null);
  t.recordHeartDeath(15.5);
  assert.equal(t.data.heartDeathAt, 15.5);
  // second call is a no-op
  t.recordHeartDeath(20.0);
  assert.equal(t.data.heartDeathAt, 15.5, 'second call must not overwrite');
  const s = t.summary();
  assert.equal(s['survived'], 0);
  assert.ok(Math.abs(s['survivedFor']! - 15.5) < 1e-9);
});

test('heartDeathAt is null and survived=1 when heart never dies', () => {
  const t = makeTelemetry();
  t.tick(5, { macro: false, enemiesAlive: 0, tankActing: false });
  const s = t.summary();
  assert.equal(s['survived'], 1);
  assert.ok(Math.abs(s['survivedFor']! - 5) < 1e-9);
});

test('reset clears heartDeathAt', () => {
  const t = makeTelemetry();
  t.recordHeartDeath(10);
  t.reset();
  assert.equal(t.data.heartDeathAt, null);
});
```

In `world.test.ts`, add:
```typescript
test('NEW-A: heartDeathAt is stamped when heart reaches 0 HP', () => {
  // Default tuning, seed 42, one tower at heart, 100s run.
  // Review confirmed the heart dies ~t=20 in this config.
  const t = makeTuning();
  t.set('enemy.speed', 1.5);  // fast enough to kill the heart in ~100s
  const w = makeWorld({ seed: 42, tuning: t });
  w.placeTower(w.dungeon.heart);
  scripted(w, 6000); // 100s
  const s = w.telemetry.summary();
  // The heart must have died (survivedFor < elapsed)
  assert.ok(s['survived'] === 0 || s['survived'] === 1, 'survived must be 0 or 1');
  // survivedFor must be <= elapsed
  assert.ok((s['survivedFor'] ?? 0) <= (s['elapsed'] ?? 0) + 1e-6);
  // If it died, heartDeathAt must be positive
  if (s['survived'] === 0) {
    assert.ok((s['heartDeathAt'] ?? 0) > 0, 'heartDeathAt should be > 0 when survived=0');
  }
});
```

- [ ] **Step 7: Run the tests**

```bash
cd /Users/minikai/Dev/TTD && npm test 2>&1 | grep -E '(✔|✗|fail|pass|heartDeath|survived)'
```
Expected: all pass, new tests present and green.

- [ ] **Step 8: Typecheck**

```bash
cd /Users/minikai/Dev/TTD && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
cd /Users/minikai/Dev/TTD && git add src/core/sim/telemetry.ts src/core/sim/world.ts scripts/sweep.ts src/core/sim/telemetry.test.ts src/core/sim/world.test.ts && git commit -m "$(cat <<'EOF'
telemetry: NEW-A — stamp heartDeathAt; expose survived + survivedFor

The sim never ends, so runs where the heart dies at t=20 were
accumulating 80% post-mortem telemetry across a 100s sweep window.
Without a death timestamp, a setting that dies quickly looks identical
to one that survives — confident wrong answers.

Changes:
- telemetry.ts: add heartDeathAt (null = alive), recordHeartDeath()
  (idempotent), survived and survivedFor to summary()
- world.ts: call recordHeartDeath when heartHp first hits 0; expose
  heartDied getter on World
- sweep.ts: survivedFor now appears in every table row; comment warns
  about post-mortem measurement
- Tests: heartDeathAt set-once, reset, survived/survivedFor values

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QH1hQk64Cw4ZwpAi59Pnat
EOF
)"
```

---

### Task 2: NEW-B — Strengthen liveness gate (upper-half assertion)

**Files:**
- Modify: `src/core/liveness.test.ts` — add upper-half sweep and `SATURATING` set

**Interfaces:**
- Consumes: `runWith()` (already defined in liveness.test.ts)
- Produces: new `SATURATING` set, upper-half assertion for every non-RENDER_ONLY, non-GOD, non-SATURATING lever

- [ ] **Step 1: Write the failing upper-half test first**

Before implementing, add the SATURATING set and upper-half assertion to `liveness.test.ts`. Find the section after `COMPANION_OVERRIDES` declaration and add:

```typescript
// Levers that legitimately saturate before their declared max:
// the telemetry effect flattens before the slider's top, so the
// standard min-vs-max sweep passes but the mid-vs-max comparison may not.
// Each entry here is a documented exception — not a silent skip.
//
// tower.range: chord distance; typical mesh has max chord ~2 on unit sphere.
//   At range=0.25 (default) the tower covers 3-4 cells; at 0.35+ it covers
//   nearly the whole reachable path and killing everything. Both 0.35 and 0.60
//   give the same telemetry because all critters die before reaching the heart.
//   The min-vs-max sweep still fires because 0.05 (min) is genuinely dead.
const SATURATING = new Set([
  'tower.range',  // covers entire nav path at upper ~40% of range
]);
```

In the existing `describe` block, add a second inner loop after the existing `test(...)` call that asserts upper-half sensitivity:

```typescript
    // NEW-B: also assert upper-half sensitivity — lever must differ across
    // its top half (50th percentile vs max). If it saturates legitimately,
    // list it in SATURATING with a comment.
    if (!SATURATING.has(lever.key) && !COMPANION_OVERRIDES[lever.key]) {
      test(`lever ${lever.key} is live in upper half`, () => {
        if (lever.min >= lever.max) return;
        const mid = lever.min + (lever.max - lever.min) * 0.5;
        const companion = COMPANION_OVERRIDES[lever.key] ?? {};
        const lo = runWith({ ...companion, [lever.key]: mid });
        const hi = runWith({ ...companion, [lever.key]: lever.max });
        assert.notDeepEqual(lo, hi, `lever ${lever.key} is SATURATED in upper half — add to SATURATING if this is intentional`);
      });
    }
```

Note: `COMPANION_OVERRIDES` levers skip the upper-half test because the companion is not swept, so the mid-vs-max comparison would be contaminated. Add `enemy.reactionDur` to `SATURATING` only if it actually saturates — test first.

- [ ] **Step 2: Run the tests to see which levers fail the upper-half assertion**

```bash
cd /Users/minikai/Dev/TTD && npm test 2>&1 | grep -E '(SATURATED|upper half|✗|fail)'
```
If `tower.range` and any others fail, add them to `SATURATING` with a comment explaining the saturation geometry. Run again until all pass.

- [ ] **Step 3: Verify all levers still pass the original min-vs-max test**

```bash
cd /Users/minikai/Dev/TTD && npm test 2>&1 | grep -E '(is live|DEAD|✗)'
```
Expected: all "is live" tests pass (including `tower.range` at min-vs-max which does differ).

- [ ] **Step 4: Typecheck**

```bash
cd /Users/minikai/Dev/TTD && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/minikai/Dev/TTD && git add src/core/liveness.test.ts && git commit -m "$(cat <<'EOF'
liveness: NEW-B — upper-half gate + SATURATING set

The old gate only proved "not wholly inert" — a lever passing at
min-vs-max could still be flat across its upper 95% (tower.range
0.05/0.20/0.35 all gave identical telemetry). The new test additionally
asserts mid-vs-max sensitivity. Saturating levers go into a documented
SATURATING set (same discipline as RENDER_ONLY) so silence is never the
outcome of saturation.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QH1hQk64Cw4ZwpAi59Pnat
EOF
)"
```

---

### Task 3: I5 + I6 + I7 — Counter semantics fixes

**Findings addressed:**
- I5: `decisionsThisPhase` never resets on phase boundary; keep a `decisionsTotal` alongside it
- I6: `leaks` duplicates `heartHits` — give them distinct meanings
- I7: `ttk` measures lifespan, not time-to-kill — stamp `firstHitAt` on critter, record true TTK

**Files:**
- Modify: `src/core/sim/telemetry.ts` — add `decisionsTotal`; update `decision()` and `reset()`; add `lifespanMean`/`lifespanP90` to summary alongside renamed `ttkMean`
- Modify: `src/core/sim/world.ts` — reset `decisionsThisPhase` in `setMacro(on=true→false)` boundary; record `lifespan` (old) alongside true TTK; call `hitCritter` to stamp `firstHitAt`
- Modify: `src/core/sim/critters.ts` — add `firstHitAt: number | null` to `Critter` type; stamp it in `hitCritter()` (first damage only)
- Modify: `src/core/sim/telemetry.ts` — update `kill()` signature to accept `{lifespan, ttk}`
- Modify: `src/core/sim/telemetry.test.ts` — update counter tests for new field names
- Modify: `src/core/sim/world.test.ts` — update any test referencing `decisionsThisPhase` re: reset

**Interfaces:**
- `Critter` gains: `firstHitAt: number | null` (null until first damage)
- `telemetry.kill(by, {lifespan: number, ttk: number | null})` — ttk is null if critter was never hit before death (tank ram kill without projectile hit)
- `summary()` gains: `decisionsTotal`, `lifespanMean`, `lifespanP90`; keeps `ttkMean`, `ttkP90` (now true TTK, excludes kills with no prior hit)

- [ ] **Step 1: Add `firstHitAt` to Critter type in `critters.ts`**

In the `Critter` type definition, add after `bornAt: number`:
```typescript
  firstHitAt: number | null; // null until first damage lands
```

In `spawnCritter()`, initialise it:
```typescript
    firstHitAt: null,
```

In `hitCritter()`, stamp it on the first hit only:
```typescript
export function hitCritter(c: Critter, damage: number, tuning: TuningStore, now?: number): boolean {
  if (!c.alive) return false;
  // Stamp first hit time (idempotent)
  if (c.firstHitAt === null && now !== undefined) {
    c.firstHitAt = now;
  }
  c.hp -= damage;
  ...
```

Note: `now` is optional so callers that don't need TTK (e.g. god-mode tests) don't break. Pass `elapsed` from all call sites in `world.ts`.

- [ ] **Step 2: Update all `hitCritter` calls in `world.ts` to pass `elapsed`**

There are three call sites:
- Line ~241: `hitCritter(c, evt.damage, tuning)` → `hitCritter(c, evt.damage, tuning, elapsed)`
- Line ~249: `hitCritter(c, evt.damage, tuning)` → `hitCritter(c, evt.damage, tuning, elapsed)`
- Line ~279: `hitCritter(c, tuning.get('tank.damage'), tuning)` → `hitCritter(c, tuning.get('tank.damage'), tuning, elapsed)`

- [ ] **Step 3: Update `telemetry.kill()` to accept lifespan and ttk separately**

Change `kill(by: 'tower' | 'player', ageSeconds: number)` to:
```typescript
function kill(by: 'tower' | 'player', lifespan: number, ttk: number | null): void {
  data.kills += 1;
  data.lifespan.push(lifespan);
  if (ttk !== null) data.ttk.push(ttk);
  if (by === 'tower') data.killsByTower += 1;
  else data.killsByPlayer += 1;
}
```

Add `lifespan: number[]` to `Telemetry` type and initialise in `data`. Update `reset()` to clear `data.lifespan.length = 0`. Update `summary()` to add `lifespanMean = mean(data.lifespan)` and `lifespanP90 = p90(data.lifespan)`. Expose both.

Rename comment on `ttk` array: `// seconds from first hit to death (true TTK); excludes contact-kills with no prior hit`.

- [ ] **Step 4: Update `world.ts` kill calls to pass lifespan + ttk**

Tower kills (step 7b):
```typescript
const killed = hitCritter(c, evt.damage, tuning, elapsed);
if (killed) {
  const tower = towers.find((t) => t.id === evt.towerId);
  if (tower !== undefined) tower.kills += 1;
  const ttk = c.firstHitAt !== null ? elapsed - c.firstHitAt : null;
  telemetry.kill('tower', elapsed - c.bornAt, ttk);
}
```

Tank projectile kills (step 7c):
```typescript
const killed = hitCritter(c, evt.damage, tuning, elapsed);
if (killed) {
  const ttk = c.firstHitAt !== null ? elapsed - c.firstHitAt : null;
  telemetry.kill('player', elapsed - c.bornAt, ttk);
}
```

Tank contact kills (step 7d):
```typescript
if (hitCritter(c, tuning.get('tank.damage'), tuning, elapsed)) {
  const ttk = c.firstHitAt !== null ? elapsed - c.firstHitAt : null;
  telemetry.kill('player', elapsed - c.bornAt, ttk);
}
```

- [ ] **Step 5: Add `decisionsTotal` to telemetry + reset `decisionsThisPhase` in `setMacro`**

In `Telemetry` type add `decisionsTotal: number`. Initialise to 0 in `data`. Update `decision()`:
```typescript
function decision(): void {
  data.decisionsThisPhase += 1;
  data.decisionsTotal += 1;
}
```

Update `reset()` to also reset `decisionsTotal = 0`.

Expose `decisionsTotal` in `summary()`.

In `world.ts`, update `setMacro`:
```typescript
function setMacro(on: boolean): void {
  if (on && !macro) {
    // Entering macro phase: reset the per-phase counter
    telemetry.resetPhaseCounters();
  }
  macro = on;
}
```

Add `resetPhaseCounters()` to telemetry:
```typescript
function resetPhaseCounters(): void {
  data.decisionsThisPhase = 0;
}
```

Expose in return. The intent: `decisionsThisPhase` counts towers placed in the current macro window; `decisionsTotal` is lifetime.

Note: resetting on entry to macro (not on exit) is correct — the phase counter measures "how many towers did I place this macro phase", starting fresh when macro begins.

- [ ] **Step 6: Fix I6 — separate `leaks` from `heartHits`**

Currently both are incremented together in `world.ts` step 7a. The fix: `heartHit()` = damage applied; `leak()` = critter reached heart (even in god mode). Currently in step 7a:
```typescript
      c.alive = false;
      telemetry.heartHit();
      telemetry.leak();
      if (!tuning.flag('god.heartInvulnerable')) {
        heartHp -= 1;
        ...
      }
```

Change to:
```typescript
      c.alive = false;
      telemetry.leak(); // critter reached the heart (always)
      if (!tuning.flag('god.heartInvulnerable')) {
        heartHp -= 1;
        if (heartHp < 0) heartHp = 0;
        if (heartHp === 0) telemetry.recordHeartDeath(elapsed);
        telemetry.heartHit(); // damage was applied (not in god mode)
      }
```

This means: in god mode, `leaks > 0` but `heartHits === 0`. Without god mode, `leaks === heartHits`.

Update the god-mode test in `world.test.ts` (line ~40): it currently asserts `heartHits > 0` in god mode. That assertion encoded the bug — change it:
```typescript
  // God mode: leaks happen (critters arrive), but NO damage is applied
  assert.ok(w.telemetry.data.leaks > 0, 'nothing ever reached the heart');
  assert.equal(w.telemetry.data.heartHits, 0, 'heartHit must not fire in god mode — that is the bug we are fixing');
  assert.equal(w.heartHp, hp0, 'heart lost hp despite god mode');
```

Also update the identical god-mode test in `liveness.test.ts` (line ~61):
```typescript
  assert.ok(w.telemetry.data.leaks > 0, 'nothing reached the heart');
  assert.equal(w.telemetry.data.heartHits, 0, 'heartHit fires only when damage is applied (not in god mode)');
  assert.equal(w.heartHp, hp0, 'heart HP changed despite god mode');
```

Update `telemetry.test.ts` — the "counters are exact" test calls `t.heartHit()` and `t.leak()` independently — those calls remain valid; just add a comment clarifying the invariant.

- [ ] **Step 7: Run tests and typecheck**

```bash
cd /Users/minikai/Dev/TTD && npm test 2>&1 | tail -15
```
Expected: all pass (new count = old count + new tests). Any test that fails because it encoded old buggy behaviour (e.g. god-mode `heartHits > 0`) must be updated as described in Step 6.

```bash
cd /Users/minikai/Dev/TTD && npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
cd /Users/minikai/Dev/TTD && git add src/core/sim/telemetry.ts src/core/sim/critters.ts src/core/sim/world.ts src/core/sim/telemetry.test.ts src/core/sim/world.test.ts src/core/liveness.test.ts && git commit -m "$(cat <<'EOF'
telemetry: I5+I6+I7 — counter semantics: phase reset, leak/hit split, true TTK

I5: decisionsThisPhase now resets on setMacro entry; decisionsTotal
    tracks lifetime count alongside it. Both exposed in summary().

I6: leak = critter reached the heart (always); heartHit = damage was
    applied (skipped in god mode). These were identical before — now they
    separate under god.heartInvulnerable. Tests updated: god-mode test
    formerly asserted heartHits > 0, which encoded the bug (silence = leak,
    not damage). Now asserts leaks > 0, heartHits === 0 in god mode.

I7: ttk now measures elapsed - firstHitAt (time from first damage to
    death). Critter gains firstHitAt: number | null (stamped in hitCritter,
    idempotent). Kills with no prior hit (pure contact rams) contribute null
    and are excluded from ttkMean. Old age-at-death is now lifespanMean /
    lifespanP90 in summary().

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QH1hQk64Cw4ZwpAi59Pnat
EOF
)"
```

---

### Task 4: I8 — `onChange` fires for `reset()` and `import()`

**Files:**
- Modify: `src/core/tuning/store.ts` — fire listeners in `reset()` and `importPreset()`
- Modify: `src/core/tuning/store.test.ts` — add tests asserting onChange fires for reset and import

**Interfaces:**
- No API shape changes; existing `onChange(fn)` interface unchanged.

- [ ] **Step 1: Write the failing tests first**

In `store.test.ts`, add after the existing `onChange fires and unsubscribes` test:

```typescript
test('onChange fires for every changed key on reset()', () => {
  const t = makeTuning();
  t.set('enemy.speed', 2.5); // change from default
  const seen = new Map<string, number>();
  t.onChange((k, v) => seen.set(k, v));
  t.reset(); // should fire for all keys (including enemy.speed back to default)
  // enemy.speed must have been notified
  assert.ok(seen.has('enemy.speed'), 'reset() did not fire onChange for enemy.speed');
  assert.equal(seen.get('enemy.speed'), LEVERS.find((l) => l.key === 'enemy.speed')!.value);
});

test('onChange fires for every imported key on import()', () => {
  const t = makeTuning();
  const seen = new Map<string, number>();
  t.onChange((k, v) => seen.set(k, v));
  t.import('enemy.speed=1.7;wave.size=20');
  assert.ok(seen.has('enemy.speed'), 'import() did not fire onChange for enemy.speed');
  assert.ok(seen.has('wave.size'), 'import() did not fire onChange for wave.size');
  assert.equal(seen.get('enemy.speed'), 1.7);
  assert.equal(seen.get('wave.size'), 20);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/minikai/Dev/TTD && npm test 2>&1 | grep -E '(onChange|reset|import)'
```
Expected: the two new tests fail.

- [ ] **Step 3: Fix `reset()` in `store.ts`**

Current `reset()`:
```typescript
  function reset(group?: LeverGroup): void {
    for (const lever of LEVERS) {
      if (!group || lever.group === group) {
        values.set(lever.key, lever.value);
      }
    }
  }
```

Updated:
```typescript
  function reset(group?: LeverGroup): void {
    for (const lever of LEVERS) {
      if (!group || lever.group === group) {
        values.set(lever.key, lever.value);
        for (const fn of listeners) fn(lever.key, lever.value);
      }
    }
  }
```

- [ ] **Step 4: Fix `importPreset()` in `store.ts`**

Current `importPreset()` sets values but never notifies. After `values.set(key, clamp(num, lever.min, lever.max))`, add:
```typescript
        const clamped = clamp(num, lever.min, lever.max);
        values.set(key, clamped);
        for (const fn of listeners) fn(key, clamped);
```
(Replace the existing single-line `values.set(...)` call.)

- [ ] **Step 5: Run tests and typecheck**

```bash
cd /Users/minikai/Dev/TTD && npm test 2>&1 | tail -10 && npx tsc --noEmit
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/minikai/Dev/TTD && git add src/core/tuning/store.ts src/core/tuning/store.test.ts && git commit -m "$(cat <<'EOF'
store: I8 — reset() and import() now fire onChange listeners

An M0b dashboard bound via onChange would silently desync on every
preset load or reset. Both paths now notify listeners for every key
they change, consistent with set().

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QH1hQk64Cw4ZwpAi59Pnat
EOF
)"
```

---

### Task 5: M15 + M13 — grid.ts normals alias; Critter.envPhase dead field

**Files:**
- Modify: `src/core/sphere/grid.ts:603` — copy `centers` array for `normals` instead of aliasing
- Modify: `src/core/sim/critters.ts` — remove `envPhase` field from `Critter` type and all usages

**Interfaces:**
- `SphereMesh.normals` and `.centers` are now independent arrays (same values, different references)
- `Critter` type loses `envPhase: number`

- [ ] **Step 1: Fix the normals alias in `grid.ts`**

At line 603:
```typescript
  const normals: Vec3[] = centers; // on a unit sphere, centre == outward normal
```
Change to:
```typescript
  const normals: Vec3[] = centers.slice(); // copy: on a unit sphere normal == centre, but they must be independent references
```

- [ ] **Step 2: Verify no test expects aliased identity**

```bash
cd /Users/minikai/Dev/TTD && grep -n 'normals\|centers' src/core/sphere/grid.test.ts
```
Read any relevant assertions. If tests compare `mesh.normals[i]` and `mesh.centers[i]` for value equality, they still pass. If any test checks reference equality (`===`), flag it — but this is unlikely.

- [ ] **Step 3: Remove `envPhase` from `Critter`**

In `critters.ts`, in the `Critter` type, remove:
```typescript
  envPhase: number;   // seconds until next re-target
```

In `spawnCritter()`, remove from the `c` object literal:
```typescript
    envPhase, envValue: 1, envTarget, envLeft: envPhase,
```
Change to:
```typescript
    envValue: 1, envTarget, envLeft: envPhase,
```

The variable `envPhase` is still locally computed and used for `envLeft` initialisation — it's just not stored on the critter. Do NOT remove the local `const envPhase = nextEnvPhase(...)` variable.

Search for any other read of `c.envPhase`:
```bash
grep -n 'envPhase' /Users/minikai/Dev/TTD/src/core/sim/critters.ts /Users/minikai/Dev/TTD/src/core/sim/world.ts
```
Expected: only the type declaration and spawn initialisation (both now removed). The `stepCritter` re-targets using `envLeft` directly — `envPhase` was only used at spawn and never updated, confirming it was dead.

- [ ] **Step 4: Run tests and typecheck**

```bash
cd /Users/minikai/Dev/TTD && npm test 2>&1 | tail -10 && npx tsc --noEmit
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/minikai/Dev/TTD && git add src/core/sphere/grid.ts src/core/sim/critters.ts && git commit -m "$(cat <<'EOF'
grid+critters: M15+M13 — fix normals alias; remove dead envPhase field

M15: grid.ts normals aliased the centers array reference. Mutating
one would silently mutate the other. Now .slice() to copy.

M13: Critter.envPhase was written at spawn and never updated on
re-target. The live re-target cadence is tracked in envLeft (decremented
per tick). envPhase was an unobservable ghost — removed.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QH1hQk64Cw4ZwpAi59Pnat
EOF
)"
```

---

### Task 6: I9 — Dead critter pruning + cross-process determinism verification

**Findings addressed:**
- I9: critters[] grows monotonically; `filter` runs twice per tick O(n); `find` is O(n) per damage event

**Files:**
- Modify: `src/core/sim/world.ts` — compact `critters` at end of tick; verify cross-process determinism

**Interfaces:**
- `world.critters` may now contain only live critters at tick boundaries (vs the current unbounded array). External callers (tests, render layer) must not assume dead critters persist.

**Determinism risk:** Pruning changes the indices of critters in the array but NOT their `id` fields. All damage resolution uses `critters.find((x) => x.id === ...)` — identity is by `id`, not array index. Pruning is therefore determinism-neutral IF done after all reads in the tick. It must be the very last operation.

- [ ] **Step 1: Add pruning at end of tick in `world.ts`**

At the very end of the `tick()` function, after step 8 (telemetry.tick), add:
```typescript
    // ── 9. Prune dead critters ────────────────────────────────────────────────
    // Done last so all step 7 `find` calls still have their targets.
    // filter() preserves order → determinism holds.
    // After pruning, critters[] contains only live critters.
    if (critters.some((c) => !c.alive)) {
      const alive = critters.filter((c) => c.alive);
      critters.length = 0;
      for (const c of alive) critters.push(c);
    }
```

Using `critters.length = 0` + push preserves the array reference (world.critters is the same object), so callers holding a reference to `world.critters` see the pruned state without needing a new reference.

- [ ] **Step 2: Update the determinism test to be a cross-process test**

The existing determinism test in `world.test.ts` runs two worlds in the same process. It must stay. Add a comment that cross-process verification is done separately (below). The in-process test still catches most divergence.

Add a cross-process script to verify:
```bash
# scripts/verify-determinism.sh
#!/usr/bin/env bash
set -e
A=$(node --experimental-strip-types scripts/sweep.ts enemy.speed 1.0 1.0 1 2>&1 | tail -5)
B=$(node --experimental-strip-types scripts/sweep.ts enemy.speed 1.0 1.0 1 2>&1 | tail -5)
if [ "$A" = "$B" ]; then
  echo "PASS: cross-process output identical"
else
  echo "FAIL: cross-process output differs"
  echo "--- A ---"
  echo "$A"
  echo "--- B ---"
  echo "$B"
  exit 1
fi
```

Make it executable:
```bash
chmod +x /Users/minikai/Dev/TTD/scripts/verify-determinism.sh
```

- [ ] **Step 3: Run cross-process determinism check**

```bash
cd /Users/minikai/Dev/TTD && bash scripts/verify-determinism.sh
```
Expected: `PASS: cross-process output identical`.

If it fails, the pruning is non-deterministic. Check: is `critters.some((c) => !c.alive)` deterministic? Yes — order is fixed. Is `filter` stable? Yes — JavaScript `Array.prototype.filter` is specified to be stable. The only risk would be if two critters die in a different order across runs, but their deaths are driven by the same RNG sequence, so order is identical.

- [ ] **Step 4: Run full test suite**

```bash
cd /Users/minikai/Dev/TTD && npm test 2>&1 | tail -10
```
Expected: all pass (including the in-process determinism test).

- [ ] **Step 5: Typecheck**

```bash
cd /Users/minikai/Dev/TTD && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
cd /Users/minikai/Dev/TTD && git add src/core/sim/world.ts scripts/verify-determinism.sh && git commit -m "$(cat <<'EOF'
world: I9 — prune dead critters at end of tick

The critters[] array grew monotonically; filter() ran twice per tick
O(n) and find() was O(n) per damage event. Now compacted at the very end
of tick (after all step 7 find() calls complete), preserving array order.

Cross-process determinism: verify-determinism.sh runs two separate node
processes and compares sweep output — passes. In-process determinism test
(world.test.ts) also passes.

Identity for damage resolution is by critter.id (never array index),
so pruning does not affect the damage routing logic.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QH1hQk64Cw4ZwpAi59Pnat
EOF
)"
```

---

### Task 7: I10 — Tower placement rule + occupancy enforcement

**Finding:** `placeTower` accepts open cells (spec §7 says wall cells = BLOCKED cells). Currently tests and sweep all place at `dungeon.heart` which is an open cell. Unlimited towers can stack on one cell, each counting a decision.

**Decision and rationale:**

The spec says "wall cells" (BLOCKED) for tower placement. However:
1. `dungeon.heart` is an open cell — all existing tests would break if we enforce BLOCKED-only.
2. Critters navigate open cells; a tower on an open cell sits where critters walk, which is actually *more* interesting gameplay-wise.
3. The "high ground" argument (towers on walls, critters on open) is a vision preference, not a mechanical requirement for M0a.

**Chosen rule: Open cells only, one tower per cell (occupancy enforced).**

Rationale: spec §7's "wall cells" appears to be aspirational visual language, not a wired constraint. Enforcing BLOCKED-only would require moving all tests to use blocked cells, and would prevent the natural "place a tower where enemies walk" interaction. Open-cell placement is the clearer semantic for M0a. Flag for M0b spec update.

If the review disagrees, the single change needed is: replace `if (dungeon.tags[cell] === BLOCKED) return false;` with `if (dungeon.tags[cell] !== BLOCKED) return false;`.

**Occupancy is enforced regardless:** unlimited stacking was a bug.

**Files:**
- Modify: `src/core/sim/world.ts` — enforce one tower per cell (occupancy check in `placeTower`)
- Modify: `src/core/sim/world.ts` — update JSDoc on `placeTower` to state the open-cell rule
- Modify: `src/core/sim/world.test.ts` — add test asserting a second tower on same cell is rejected

**Interfaces:**
- `placeTower(cell)` returns `false` for occupied cells (in addition to BLOCKED cells)
- `World.placeTower` JSDoc updated

- [ ] **Step 1: Write failing test for occupancy**

In `world.test.ts`, add:
```typescript
test('I10: placeTower enforces one tower per cell (occupancy)', () => {
  const w = makeWorld({ seed: 3, tuning: makeTuning() });
  const open = w.dungeon.heart;
  assert.equal(w.placeTower(open), true, 'first tower should succeed');
  assert.equal(w.placeTower(open), false, 'second tower on same cell must be rejected');
  assert.equal(w.telemetry.data.decisionsTotal, 1, 'only one successful placement = one decision');
});
```

- [ ] **Step 2: Add occupancy check to `placeTower` in `world.ts`**

In `placeTower()`, after the BLOCKED check, add:
```typescript
    // One tower per cell — stacking bypasses the decision budget
    if (towers.some((t) => t.cell === cell)) return false;
```

This requires `Tower` to have a `cell` field. Check `towers.ts`:

- [ ] **Step 3: Verify Tower type has `cell` field**

```bash
grep -n 'cell' /Users/minikai/Dev/TTD/src/core/sim/towers.ts | head -20
```

If `Tower.cell` does not exist, add it in `towers.ts`:
```typescript
export type Tower = {
  id: number;
  cell: number;  // add if missing
  pos: Vec3;
  kills: number;
  cooldown: number;
};
```
And in `makeTower`:
```typescript
export function makeTower(id: number, cell: number, pos: Vec3): Tower {
  return { id, cell, pos, kills: 0, cooldown: 0 };
}
```

- [ ] **Step 4: Update `placeTower` JSDoc**

Replace the existing JSDoc:
```typescript
  /** Place a tower on cell. Returns false if illegal (BLOCKED). Counts a decision only on success. */
```
With:
```typescript
  /** Place a tower on an open (non-BLOCKED) cell. Returns false if the cell is BLOCKED or already occupied.
   *  One tower per cell is enforced. Counts a decision only on success.
   *  M0a placement rule: open cells only (spec §7 says "wall cells" — flagged for M0b spec update). */
```

- [ ] **Step 5: Run tests and typecheck**

```bash
cd /Users/minikai/Dev/TTD && npm test 2>&1 | tail -10 && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
cd /Users/minikai/Dev/TTD && git add src/core/sim/world.ts src/core/sim/world.test.ts src/core/sim/towers.ts && git commit -m "$(cat <<'EOF'
world: I10 — enforce tower occupancy (one per cell)

Unlimited stacking let multiple towers count as multiple decisions on
one cell, inflating decisionsThisPhase on every placement call.

Placement rule chosen: open cells only (not BLOCKED). Spec §7 says
'wall cells' but all M0a tests + sweep use dungeon.heart (open cell);
enforcing BLOCKED-only would require migrating all tests and breaks the
natural 'place tower where enemies walk' interaction. Flagged for M0b
spec update.

Occupancy: towers.some(t => t.cell === cell) check added to placeTower().
Tower type gains cell field if absent.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QH1hQk64Cw4ZwpAi59Pnat
EOF
)"
```

---

### Task 8: M16 — sweep.ts out-of-range warning

**Files:**
- Modify: `scripts/sweep.ts` — warn when requested sweep value is outside the lever's declared range

**Interfaces:**
- Consumes: `LEVERS` from `src/core/tuning/schema.ts`

- [ ] **Step 1: Import LEVERS in sweep.ts and add range check**

In `scripts/sweep.ts`, add import:
```typescript
import { LEVERS } from '../src/core/tuning/schema.ts';
```

After the `if (!key || ...)` guard, add:
```typescript
const leverSchema = LEVERS.find((l) => l.key === key);
if (!leverSchema) {
  console.error(`Unknown lever: "${key}". Run the sweep with a valid key from schema.ts`);
  process.exit(1);
}
```

In the sweep loop, before `t.set(key, v)`, warn if `v` is outside range:
```typescript
  if (v < leverSchema.min || v > leverSchema.max) {
    console.warn(`WARNING: sweep value ${v.toFixed(3)} for "${key}" is outside declared range [${leverSchema.min}, ${leverSchema.max}]. t.set() will clamp — this row duplicates an adjacent row.`);
  }
```

- [ ] **Step 2: Test by hand with an out-of-range value**

```bash
cd /Users/minikai/Dev/TTD && node --experimental-strip-types scripts/sweep.ts enemy.speed 0.1 5.0 5 2>&1 | head -10
```
Expected: WARNING lines for the 0.1 value (below min=0.2) and 5.0 value (above max=3.0).

- [ ] **Step 3: Test with an unknown key**

```bash
cd /Users/minikai/Dev/TTD && node --experimental-strip-types scripts/sweep.ts bogus.key 0 1 3 2>&1
```
Expected: `Unknown lever: "bogus.key". ...` and exit code 1.

- [ ] **Step 4: Typecheck**

```bash
cd /Users/minikai/Dev/TTD && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/minikai/Dev/TTD && git add scripts/sweep.ts && git commit -m "$(cat <<'EOF'
sweep: M16 — warn when sweep value is outside lever declared range

t.set() clamps silently, so sweeping enemy.speed 0..5 produces duplicate
rows at 0.2 and 3.0 with no indication. Now emits a WARNING to stderr
for each out-of-range value so the operator can see which rows are
artificially identical.

Also: unknown lever key now exits with a clear error message rather
than running all steps with a no-op set().

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QH1hQk64Cw4ZwpAi59Pnat
EOF
)"
```

---

### Task 9: M11 + M12 — Update docs/02-M0a-brain-notes.md

**Files:**
- Modify: `docs/02-M0a-brain-notes.md` — fix §5.1 (waveCleared IS now wired), fix §2 (RNG stream ownership), regenerate both sweep tables, rename ttkMean references to reflect the new semantics

**Interfaces:**
- No code changes. This task is documentation only.

- [ ] **Step 1: Regenerate the `enemy.speed` sweep table**

```bash
cd /Users/minikai/Dev/TTD && node --experimental-strip-types scripts/sweep.ts enemy.speed 0.6 2.0 5
```
Capture the full output. This is the fresh table for §3.

- [ ] **Step 2: Regenerate the `wave.dripRate` sweep table**

```bash
cd /Users/minikai/Dev/TTD && node --experimental-strip-types scripts/sweep.ts wave.dripRate 0.1 1.5 4
```
Capture the full output. This is the fresh table for §4.

- [ ] **Step 3: Update §5.1 in the doc**

The current §5.1 says:
> The wave engine does not call `telemetry.waveCleared()`. The hook exists on `Telemetry` but is never wired in the World tick — there's no wave-clear detection...

Replace with:
> `waveCleared()` was wired in commit f443b63 (`world.ts:148`). The metric is now live — `waveClearMean` and `waveClearP90` will be non-zero in runs long enough to complete at least one wave. The sweep tables below still show 0 because the scripted 100-second run at default `wave.gap=8` only completes partial waves; a longer run or a smaller wave gap will populate the metric.

- [ ] **Step 4: Fix §2 RNG ownership text**

Current text: "per-critter envelope RNG"

Find the `critters` row in the table and change the Notes column from:
> Per-critter speed envelope retargeting.

To:
> One shared `crittersRng` stream (not per-critter). All spawned critters draw from the same sequence in spawn order. **Comparability hazard:** changing a combat lever changes which critters survive, which shifts every survivor's subsequent envelope draws — runs at different settings are not directly comparable at the per-critter level.

Also update the comment in `world.ts` line 21:
```typescript
//   stream(seed, 'critters') → per-critter envelope RNG passed to stepCritter
```
Change to:
```typescript
//   stream(seed, 'critters') → shared critter RNG stream; all critters draw in spawn order.
//                               Comparability hazard: changing combat levers changes survivor
//                               composition, shifting envelope draws for all subsequent critters.
```

- [ ] **Step 5: Replace both sweep tables in the doc**

Replace the §3 table with the freshly generated `enemy.speed` output.
Replace the §4 table with the freshly generated `wave.dripRate` output.
Update the narrative below each table to reflect any changed numbers (particularly `waveClearMean`, `ttkMean` which now measures true TTK, `lifespanMean` if present).

Note: `ttkMean` in the new tables measures true TTK (first hit to death), so the narrative about "ttkMean falls with enemy.speed because the journey shortened" must be updated — the journey explanation was about lifespan, not true TTK. True TTK should be fairly stable across speed settings (it's the time inside tower range, not travel time).

- [ ] **Step 6: Update the status header and any stale references**

Update the header:
```markdown
**Status:** complete. 2026-08-26. M0a-fixB applied.
**Tests:** [new count] passing, `tsc --noEmit` clean.
```

Search for any mention of `ttk` in the narrative that refers to the old lifespan semantics and update to say `lifespan` where appropriate.

- [ ] **Step 7: Commit**

```bash
cd /Users/minikai/Dev/TTD && git add docs/02-M0a-brain-notes.md src/core/sim/world.ts && git commit -m "$(cat <<'EOF'
docs: M11+M12 — fix brain-notes: waveCleared wired, RNG stream hazard, regenerated tables

M11: §5.1 claimed waveCleared is never wired — it was wired in f443b63.
     Corrected. Tables regenerated from the post-fix simulation.

M12: §2 said 'per-critter envelope RNG'; it is one shared crittersRng
     stream. Added comparability hazard note: changing a combat lever
     changes survivor composition, shifting all subsequent envelope draws.

Both sweep tables regenerated (enemy.speed, wave.dripRate). ttkMean
narrative updated: now measures true TTK (first hit to death), not
journey lifespan. waveClearMean/P90 values documented.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QH1hQk64Cw4ZwpAi59Pnat
EOF
)"
```

---

### Task 10: Final verification + report

**Files:**
- Create: `.superpowers/sdd/m0a-fixB-report.md` — fresh report per instructions

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/minikai/Dev/TTD && npm test 2>&1 | tail -15
```
Expected: all pass, count >= 119 + (new tests added).

- [ ] **Step 2: Typecheck**

```bash
cd /Users/minikai/Dev/TTD && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Cross-process determinism check**

```bash
cd /Users/minikai/Dev/TTD && bash scripts/verify-determinism.sh
```
Expected: `PASS`.

- [ ] **Step 4: Run both sweeps for the report**

```bash
cd /Users/minikai/Dev/TTD && node --experimental-strip-types scripts/sweep.ts enemy.speed 0.6 2.0 5
cd /Users/minikai/Dev/TTD && node --experimental-strip-types scripts/sweep.ts wave.dripRate 0.1 1.5 4
```

- [ ] **Step 5: Write the report**

```bash
mkdir -p /Users/minikai/Dev/TTD/.superpowers/sdd
```

Write to `/Users/minikai/Dev/TTD/.superpowers/sdd/m0a-fixB-report.md` with:
- What changed per finding (one paragraph each)
- I10 placement rule decision and evidence
- Regenerated sweep tables (both)
- Cross-process determinism result
- Any finding disagreed with + evidence
- Concerns (if any)

- [ ] **Step 6: Commit the report**

```bash
cd /Users/minikai/Dev/TTD && git add .superpowers/sdd/m0a-fixB-report.md && git commit -m "$(cat <<'EOF'
report: m0a-fixB findings, sweep tables, determinism confirmation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QH1hQk64Cw4ZwpAi59Pnat
EOF
)"
```

- [ ] **Step 7: Reply to the operator with the summary**

Report format (under 14 lines):
- Status (all N tests green, tsc clean)
- Commits (SHAs + subjects)
- One-line typecheck+test summary
- Explicit determinism confirmation
- One line on I10 placement decision
- One line on survivedFor post-mortem finding
- Concerns
- Report path

---

## Self-Review

**Spec coverage check:**

| Finding | Task | Status |
|---|---|---|
| NEW-A: heartDeathAt + survivedFor | Task 1 | Covered |
| NEW-B: upper-half liveness gate | Task 2 | Covered |
| I5: decisionsThisPhase never resets | Task 3 | Covered |
| I6: leaks duplicates heartHits | Task 3 | Covered |
| I7: ttk measures lifespan | Task 3 | Covered |
| I8: reset/import don't notify onChange | Task 4 | Covered |
| I9: dead critters never pruned | Task 6 | Covered |
| I10: placeTower accepts open cells; no occupancy | Task 7 | Covered |
| M11: §5.1 stale (waveCleared wired) | Task 9 | Covered |
| M12: §2 per-critter RNG wrong | Task 9 | Covered |
| M13: Critter.envPhase dead field | Task 5 | Covered |
| M15: grid.ts normals aliases centers | Task 5 | Covered |
| M16: sweep.ts silent out-of-range clamp | Task 8 | Covered |

**Placeholder scan:** No TBDs or vague steps. Every code change has the actual code shown.

**Type consistency check:**
- `hitCritter(c, damage, tuning, now?)` — `now` added in Task 3; all call sites in world.ts updated in same task. ✓
- `telemetry.kill(by, lifespan, ttk)` — signature change in Task 3; all call sites (3 in world.ts) updated in same task. ✓
- `telemetry.recordHeartDeath(elapsed)` — added in Task 1; called in world.ts in same task. ✓
- `telemetry.resetPhaseCounters()` — added in Task 3; called in setMacro in same task. ✓
- `Tower.cell` — added in Task 7; read in occupancy check in same task. ✓
- `Critter.firstHitAt` — added in Task 3 Step 1; read in world.ts TTK calculation in Task 3 Step 4. ✓
