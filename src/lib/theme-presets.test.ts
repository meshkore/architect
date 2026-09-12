// theme-presets.test.ts — size presets must scale ALL cockpit text (cockpit-themes).
//
// Regression: the size picker only moved the `--fs-*` tokens while ~220
// hardcoded `font-size: Npx` rules (header, rails, centre content) ignored
// it. The fix wraps those in `calc(Npx * var(--fs-scale, 1))`, so every
// preset MUST ship a numeric `--fs-scale` and every preset must cover the
// full SIZE_VAR_NAMES schema.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIZE_PRESETS, SIZE_VAR_NAMES, THEMES, THEME_VAR_NAMES } from './theme-presets.ts';

test('every size preset covers the full size schema, including --fs-scale', () => {
  for (const [id, preset] of Object.entries(SIZE_PRESETS)) {
    for (const key of SIZE_VAR_NAMES) {
      assert.ok(key in preset, `${id} misses ${key}`);
    }
  }
});

test('--fs-scale is a positive number in every preset', () => {
  for (const [id, preset] of Object.entries(SIZE_PRESETS)) {
    const scale = Number(preset['--fs-scale']);
    assert.ok(Number.isFinite(scale) && scale > 0, `${id} has bad --fs-scale`);
  }
});

test('compact < default < large scale ordering', () => {
  const c = Number(SIZE_PRESETS.compact['--fs-scale']);
  const d = Number(SIZE_PRESETS.default['--fs-scale']);
  const l = Number(SIZE_PRESETS.large['--fs-scale']);
  assert.ok(c < d && d < l, `expected compact < default < large, got ${c}/${d}/${l}`);
});

test('every theme preset still covers the full theme schema', () => {
  for (const [id, preset] of Object.entries(THEMES)) {
    for (const key of THEME_VAR_NAMES) {
      assert.ok(key in preset, `${id} misses ${key}`);
    }
  }
});
