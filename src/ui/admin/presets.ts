// presets.ts — named presets, an export string, and ?preset= on the URL.
//
// Spec §9.6: a preset must round-trip — save, reload the page, identical
// behaviour; export, import, identical. tuning.export() already produces
// 'key=value;key=value' and tuning.import() already ignores unknown keys for
// forward compatibility, both tested in core. This module is storage and UI
// around that; it does NOT reimplement serialisation.
//
// A corrupt localStorage value must not brick the panel — readBook returns an
// empty book rather than throwing. Losing saved presets is annoying; losing
// the whole rig because one JSON blob got mangled is not acceptable.

import type { TuningStore } from '../../core/tuning/store.ts';

const BOOK_KEY = 'ttd.presets';

export type PresetBook = Record<string, string>;

export function parsePresetParam(search: string): string | null {
  const m = /[?&]preset=([^&]*)/.exec(search);
  return m === null ? null : decodeURIComponent(m[1] ?? '');
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

export function makePresets(tuning: TuningStore): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'admin-presets';

  const select = document.createElement('select');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'preset name';
  nameInput.className = 'admin-text';
  const exportBox = document.createElement('textarea');
  exportBox.rows = 2;
  exportBox.spellcheck = false;
  exportBox.placeholder = 'export / paste a preset string here';

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

  el.append(
    nameInput,
    btn('save', () => {
      const name = nameInput.value.trim();
      if (name === '') return;
      store(savePreset(load(), name, tuning.export()));
    }),
    select,
    btn('load', () => {
      const preset = load()[select.value];
      if (preset !== undefined) tuning.import(preset);
    }),
    btn('delete', () => store(deletePreset(load(), select.value))),
    exportBox,
    btn('export →', () => { exportBox.value = tuning.export(); exportBox.select(); }),
    btn('← import', () => tuning.import(exportBox.value.trim())),
  );
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
