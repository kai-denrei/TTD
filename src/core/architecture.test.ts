// architecture.test.ts — the invariants that keep core/ a pure brain.
//
// These are the structural rules the PoC lost: a 3,870-line tab where sim and
// render were fused, and non-determinism crept in via Math.random. Enforce
// them mechanically so they can't erode a commit at a time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE = fileURLToPath(new URL('.', import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** Strip block and line comments so prose about a rule can't trip the rule. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const files = sourceFiles(CORE);

test('core/ contains source to check', () => {
  assert.ok(files.length > 0, 'no core sources found — is the path right?');
});

test('core/ never imports three.js — the brain must run headless', () => {
  for (const f of files) {
    const code = stripComments(readFileSync(f, 'utf8'));
    assert.ok(
      !/from\s+['"]three['"]/.test(code) && !/from\s+['"]three\//.test(code),
      `${relative(CORE, f)} imports three.js; move it to render/`,
    );
  }
});

test('core/ never calls Math.random — determinism is a pillar', () => {
  for (const f of files) {
    const code = stripComments(readFileSync(f, 'utf8'));
    assert.ok(
      !/Math\s*\.\s*random\s*\(/.test(code),
      `${relative(CORE, f)} calls Math.random; draw from a seeded stream instead`,
    );
  }
});

test('core/ never touches the DOM or timers tied to wall-clock', () => {
  for (const f of files) {
    const code = stripComments(readFileSync(f, 'utf8'));
    for (const banned of ['document.', 'window.', 'performance.now(', 'Date.now(']) {
      assert.ok(
        !code.includes(banned),
        `${relative(CORE, f)} uses ${banned}; core is pure — take time as a dt parameter`,
      );
    }
  }
});

// Modules under render/ that MUST stay three-free so they remain Node-testable.
// Their correctness is asserted by node --test; importing three would silently
// end that, and the erosion would look like an ordinary refactor. core/ gets
// this guard by recursion — these do not, because they are not under core/.
const PURE_RENDER = ['bindings.ts', 'geometry.ts'];

test('pure render modules never import three.js', () => {
  const renderDir = fileURLToPath(new URL('../render/', import.meta.url));
  for (const name of PURE_RENDER) {
    const code = stripComments(readFileSync(join(renderDir, name), 'utf8'));
    assert.ok(
      !/from\s+['"]three['"]/.test(code) && !/from\s+['"]three\//.test(code),
      `render/${name} imports three.js but is on the pure list; either keep it pure, or remove it from PURE_RENDER and drop its Node tests`,
    );
  }
});
