// store.ts — the live tuning store.
//
// Two properties dominate the design:
//
//   1. Live by construction. Systems call tuning.get('enemy.speed') inside
//      their tick — the store must make that cheap and always current. Values
//      are never captured at construction.
//
//   2. A typo must not silently read zero. get() on an unknown key THROWS
//      with a message that names the key. In a project with ~25 string-keyed
//      levers, a silent 0 would be a nightmare: you'd be tuning a game that
//      ignores you.
//
// No localStorage, no DOM, no wall-clock — persistence belongs to the UI
// layer (M0b). This module is pure core.

import { LEVERS } from './schema.ts';
import type { Lever, LeverGroup } from './schema.ts';

export type { Lever, LeverGroup };
export { LEVERS };

export type TuningStore = {
  /** Numeric value for a lever. Throws on an unknown key. */
  get(key: string): number;
  /** Boolean read: value !== 0. Throws on an unknown key. */
  flag(key: string): boolean;
  /** Set a lever's value, clamped to [min, max]. Throws on an unknown key. */
  set(key: string, value: number): void;
  /** All levers with their current values. */
  all(): Lever[];
  /** Reset levers to defaults, optionally scoped to one group. */
  reset(group?: LeverGroup): void;
  /** Compact preset string: 'key=value;key=value;…' */
  export(): string;
  /** Apply a preset string. Unknown keys are silently ignored; missing keys keep their current value. */
  import(text: string): void;
  /** Subscribe to value changes. Returns an unsubscribe function. */
  onChange(fn: (key: string, value: number) => void): () => void;
};

/**
 * Create a live tuning store, optionally seeded with override values.
 * Systems should call get() inside their tick — never cache the result.
 */
export function makeTuning(overrides?: Record<string, number>): TuningStore {
  // Mutable state: one map from key → current value
  const values = new Map<string, number>();
  // Index from key → schema entry for range clamping
  const schema = new Map<string, Lever>();

  for (const lever of LEVERS) {
    schema.set(lever.key, lever);
    values.set(lever.key, lever.value);
  }

  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      const lever = schema.get(k);
      if (lever) {
        values.set(k, clamp(v, lever.min, lever.max));
      }
    }
  }

  const listeners = new Set<(key: string, value: number) => void>();

  function requireLever(key: string): Lever {
    const lever = schema.get(key);
    if (!lever) throw new Error(`unknown lever: "${key}"`);
    return lever;
  }

  function get(key: string): number {
    requireLever(key);
    // values always has an entry for every schema key
    return values.get(key)!;
  }

  function flag(key: string): boolean {
    return get(key) !== 0;
  }

  function set(key: string, value: number): void {
    const lever = requireLever(key);
    const clamped = clamp(value, lever.min, lever.max);
    values.set(key, clamped);
    for (const fn of listeners) fn(key, clamped);
  }

  function all(): Lever[] {
    return LEVERS.map((l) => ({ ...l, value: values.get(l.key)! }));
  }

  function reset(group?: LeverGroup): void {
    for (const lever of LEVERS) {
      if (!group || lever.group === group) {
        values.set(lever.key, lever.value);
        for (const fn of listeners) fn(lever.key, lever.value);
      }
    }
  }

  function exportPreset(): string {
    return LEVERS.map((l) => `${l.key}=${values.get(l.key)!}`).join(';');
  }

  function importPreset(text: string): void {
    const pairs = text.split(';');
    for (const pair of pairs) {
      const idx = pair.indexOf('=');
      if (idx === -1) continue;
      const key = pair.slice(0, idx).trim();
      const raw = pair.slice(idx + 1).trim();
      const lever = schema.get(key);
      if (!lever) continue; // forward-compat: ignore unknown keys
      const num = parseFloat(raw);
      if (!isFinite(num)) continue;
      const clamped = clamp(num, lever.min, lever.max);
      values.set(key, clamped);
      for (const fn of listeners) fn(key, clamped);
    }
  }

  function onChange(fn: (key: string, value: number) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { get, flag, set, all, reset, export: exportPreset, import: importPreset, onChange };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
