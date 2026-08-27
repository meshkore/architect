/**
 * task-md.test.ts — run with `npm test` (node's native TS stripping).
 *
 * These parsers have a bug history that was invisible in review and
 * only showed up as truncated text on the roadmap, so the cases below
 * are the regressions, not happy paths.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractResolution,
  stripResolutionMetaPrefix,
  extractDescription,
  taskFiles,
  taskCommits,
} from './task-md.ts';

test('extractResolution: reads the section body', () => {
  const md = ['# Task', '', '## Resolution', 'Shipped the thing.', ''].join('\n');
  assert.equal(extractResolution(md), 'Shipped the thing.');
});

test('extractResolution: a capital Z does not end the match', () => {
  // The original regex used `\Z` (a PYTHON anchor). In JS that is an
  // identity escape for a literal "Z", so this resolution rendered as
  // "Fixed the ".
  const md = '## Resolution\nFixed the ZAI provider fallback.\n';
  assert.equal(extractResolution(md), 'Fixed the ZAI provider fallback.');
});

test('extractResolution: stops at the next H2', () => {
  const md = ['## Resolution', 'Done.', '', '## Notes', 'Not part of it.'].join('\n');
  assert.equal(extractResolution(md), 'Done.');
});

test('extractResolution: absent section is empty, not undefined', () => {
  assert.equal(extractResolution('# Task\n\nJust a body.\n'), '');
  assert.equal(extractResolution(''), '');
});

test('extractResolution: strips the legacy who/when prefix', () => {
  const md = '## Resolution\n_Resolved by A023 via `conv-x` at 2026-07-01._\n\nThe real summary.\n';
  assert.equal(extractResolution(md), 'The real summary.');
});

test('stripResolutionMetaPrefix: only strips a LEADING meta line', () => {
  assert.equal(stripResolutionMetaPrefix('_Failed (exit 1) — boom._\n\nBody.'), 'Body.');
  // A mid-text italic line that happens to start with "Failed" stays.
  const keep = 'Body.\n_Failed (exit 1) — boom._';
  assert.equal(stripResolutionMetaPrefix(keep), keep);
});

test('extractDescription: drops frontmatter and the H1, keeps the intro', () => {
  const md = [
    '---', 'id: AX14', 'title: "x"', '---',
    '# AX14 · Roadmap modular', '',
    'The intro paragraph.', '',
    '## Done when', '- [ ] something',
  ].join('\n');
  assert.equal(extractDescription(md), 'The intro paragraph.');
});

test('extractDescription: body with no sections is all description', () => {
  assert.equal(extractDescription('# T\n\nAll of it.\n'), 'All of it.');
});

test('taskFiles / taskCommits: unknown shapes yield [], never partial guesses', () => {
  assert.deepEqual(taskFiles({}), []);
  assert.deepEqual(taskFiles({ files_changed: 'a.ts' }), []);
  assert.deepEqual(taskFiles({ files_changed: ['a.ts', '', 3] }), ['a.ts']);
  assert.deepEqual(taskCommits({}), []);
});

test('taskCommits: SHAs are shortened to 9 chars', () => {
  assert.deepEqual(
    taskCommits({ commit_shas: ['0123456789abcdef', 'fedcba9876543210'] }),
    ['012345678', 'fedcba987'],
  );
});
