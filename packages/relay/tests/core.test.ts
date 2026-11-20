import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLOSE, addEvent, emptyTotals, expiredDays, meetingEvent, newSide, outcomeOfClose } from '../src/core.ts';

test('a side that met reports how long it waited and was connected, and its bytes', () => {
  const side = { ...newSide(1000), pairedAt: 4000, bytes: 512 };
  assert.deepEqual(meetingEvent(side, 'left', 10_000), { outcome: 'left', met: true, waitedMs: 3000, connectedMs: 6000, bytes: 512 });
});

test('a side nobody met waited until it ended, and was never connected', () => {
  assert.deepEqual(meetingEvent(newSide(1000), 'no_peer', 61_000), { outcome: 'no_peer', met: false, waitedMs: 60_000, connectedMs: 0, bytes: 0 });
});

test("the relay's own closes map to outcomes", () => {
  assert.equal(outcomeOfClose(CLOSE.NO_PEER), 'no_peer');
  assert.equal(outcomeOfClose(CLOSE.SILENT), 'silent');
  assert.equal(outcomeOfClose(CLOSE.LIMIT), 'limit');
  assert.equal(outcomeOfClose(CLOSE.PEER_LEFT), 'peer_left');
  assert.equal(outcomeOfClose(CLOSE.PROTOCOL), 'protocol');
});


test('totals keep only sums: counts by outcome, sides that met, time and bytes', () => {
  let t = emptyTotals();
  t = addEvent(t, { outcome: 'left', met: true, waitedMs: 100, connectedMs: 5000, bytes: 300 });
  t = addEvent(t, { outcome: 'peer_left', met: true, waitedMs: 50, connectedMs: 5000, bytes: 200 });
  t = addEvent(t, { outcome: 'no_peer', met: false, waitedMs: 60_000, connectedMs: 0, bytes: 0 });
  assert.deepEqual(t, { outcomes: { left: 1, peer_left: 1, no_peer: 1 }, met: 2, waitedMs: 60_150, connectedMs: 10_000, bytes: 500 });
});

test('days older than the keep window are the ones deleted', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  assert.deepEqual(expiredDays(['2026-10-20', '2026-10-21', '2026-11-20'], now), ['2026-10-20']);
});
