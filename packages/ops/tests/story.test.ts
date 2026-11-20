import { test } from 'node:test';
import assert from 'node:assert/strict';
import { story, sumTotals } from '../src/story.ts';
import { projectMonth } from '../src/usage.ts';

test('the story counts meetings as pairs, and says what each ending means', () => {
  const lines = story({ outcomes: { left: 3, peer_left: 3, no_peer: 310, silent: 2 }, met: 6, waitedMs: 0, connectedMs: 2 * 7_800_000, bytes: 4_100_000 });
  assert.match(lines[0]!, /met through the relay 3 times/);
  assert.match(lines[0]!, /2 h 10 min/);
  assert.match(lines[0]!, /4\.1 MB/);
  assert.ok(lines.some((l) => /310 times a device waited/.test(l)));
  assert.ok(lines.some((l) => /2 connections ended because a device went quiet/.test(l)));
});

test('an empty period says so', () => {
  assert.deepEqual(story(sumTotals([])), ['Nothing used the relay in this period.']);
});

test('days add up', () => {
  const t = sumTotals([
    { outcomes: { left: 1 }, met: 2, waitedMs: 1, connectedMs: 10, bytes: 5 },
    { outcomes: { left: 2, no_peer: 1 }, met: 2, waitedMs: 2, connectedMs: 20, bytes: 6 },
  ]);
  assert.deepEqual(t, { outcomes: { left: 3, no_peer: 1 }, met: 4, waitedMs: 3, connectedMs: 30, bytes: 11 });
});

test('the month projects from the share of it that has passed', () => {
  // Halfway through November (30 days): everything doubles.
  const p = projectMonth({ workerRequests: 100, workerCpuMs: 0, doRequests: 0, doGbSeconds: 50, bytesOut: 0, errors: 0 }, new Date('2026-11-16T00:00:00Z'));
  assert.equal(Math.round(p.workerRequests), 200);
  assert.equal(Math.round(p.doGbSeconds), 100);
});
