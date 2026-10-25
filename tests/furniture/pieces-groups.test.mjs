// The piece sheet is shot in small groups: nine pieces at most, every implemented type exactly once, similar sizes together, and a
// cell that fits the biggest piece of the group; the same input always gives the same jobs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pieceGroups, groupJobs, GROUP_MAX } from '../../tools/pieces-sheet.mjs';
import { piecesImplemented } from '../../src/furniture/index.js';
import { SPEC_BY_ID } from '../../src/furniture/specs.js';

const sizeOf = (t) => SPEC_BY_ID[t]?.size;
const dim = (t) => Math.max(...sizeOf(t).filter(Number.isFinite));

test('every implemented type is in exactly one group of at most nine', () => {
  const types = piecesImplemented(), groups = pieceGroups(types, sizeOf);
  assert.ok(groups.every((g) => g.types.length >= 1 && g.types.length <= GROUP_MAX));
  assert.deepEqual(groups.flatMap((g) => g.types).sort(), types.slice().sort());
});

test('groups run from the biggest pieces to the smallest and each cell fits its biggest piece', () => {
  const groups = pieceGroups(piecesImplemented(), sizeOf);
  for (let i = 1; i < groups.length; i++) assert.ok(Math.max(...groups[i].types.map(dim)) <= Math.min(...groups[i - 1].types.map(dim)) + 1e-9);
  for (const g of groups) {
    assert.ok(g.cell >= 0.7 && g.cell <= 4.5);
    assert.ok(g.cols >= 1 && g.cols <= 3);
    const big = Math.max(...g.types.map(dim));
    if (big * 1.3 <= 4.5) assert.ok(g.cell >= big * 1.3 - 0.01 || g.cell === 0.7, `${g.types[0]}: cell ${g.cell} for ${big}`);
  }
});

test('the jobs name a front and a back view of every group, repeatably', () => {
  const groups = pieceGroups(piecesImplemented(), sizeOf), jobs = groupJobs(groups);
  assert.equal(jobs.length, groups.length * 2);
  assert.deepEqual(jobs, groupJobs(pieceGroups(piecesImplemented(), sizeOf)));
  assert.ok(jobs[0].startsWith('g1-front=az=35&') && jobs[1].startsWith('g1-back=az=215&'));
});
