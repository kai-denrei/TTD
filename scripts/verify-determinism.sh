#!/usr/bin/env bash
# Cross-process replay determinism check.
# Runs the sweep twice in separate node processes and compares output.
# A mismatch means the simulation has non-deterministic behaviour.
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
