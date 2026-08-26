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
//   ?admin=1     typed once, then persists
//   backtick     desktop, instant
//   5-tap corner phones have no backtick key, and typing a URL parameter on a
//                phone is miserable
//
// The URL/storage logic is pure so it is Node-tested without a DOM.

const KEY = 'ttd.admin';
const TAPS_REQUIRED = 5;
const TAP_WINDOW_MS = 1500;
const CORNER_PX = 64;

function param(search: string): string | null {
  const m = /[?&]admin=([^&]*)/.exec(search);
  return m === null ? null : decodeURIComponent(m[1] ?? '');
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
    // Private mode or blocked storage: fall back to URL-only access rather
    // than throwing on boot.
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
    taps += 1;
    if (taps >= TAPS_REQUIRED) { taps = 0; unlock(); }
  });

  return {
    isOpen: () => open,
    onOpen: (fn) => { listeners.push(fn); if (open) fn(); },
  };
}
