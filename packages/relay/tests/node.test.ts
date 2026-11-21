import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startRelayServer } from '../src/node.ts';
import { TEST_LIMITS, relaySuite } from './suite.ts';

relaySuite('plain process', () => startRelayServer({ limits: TEST_LIMITS, maxPerAddress: 1000 }));

describe('relay: plain process only', () => {
  it('refuses new meetings over maxMeetings', async () => {
    const relay = await startRelayServer({ limits: TEST_LIMITS, maxMeetings: 1 });
    try {
      const a = new WebSocket(`${relay.url}/v1/pair/${'a'.repeat(64)}`);
      await new Promise((r) => a.addEventListener('open', r));
      const b = new WebSocket(`${relay.url}/v1/pair/${'b'.repeat(64)}`);
      const opened = await new Promise((r) => {
        b.addEventListener('open', () => r(true));
        b.addEventListener('close', () => r(false));
      });
      assert.equal(opened, false);
      // The first meeting can still pair.
      const c = new WebSocket(`${relay.url}/v1/pair/${'a'.repeat(64)}`);
      assert.equal(await new Promise((r) => {
        c.addEventListener('open', () => r(true));
        c.addEventListener('close', () => r(false));
      }), true);
      a.close();
    } finally {
      await relay.close();
    }
  });

  it('refuses an address over maxPerAddress, and frees its places as it leaves', async () => {
    const relay = await startRelayServer({ limits: TEST_LIMITS, maxPerAddress: 3 });
    const open = (k: string) =>
      new Promise<WebSocket | null>((r) => {
        const w = new WebSocket(`${relay.url}/v1/pair/${k.repeat(64)}`);
        w.addEventListener('open', () => r(w));
        w.addEventListener('close', () => r(null));
      });
    try {
      const held = [await open('1'), await open('2'), await open('3')];
      assert.ok(held.every(Boolean));
      assert.equal(await open('4'), null);
      held[0]!.close();
      await new Promise((r) => held[0]!.addEventListener('close', r));
      await new Promise((r) => setTimeout(r, 50));
      const again = await open('5');
      assert.ok(again);
      for (const w of [...held, again]) w?.close();
    } finally {
      await relay.close();
    }
  });

  it('delivers a burst far over the high-water mark intact', async () => {
    const relay = await startRelayServer({
      limits: { ...TEST_LIMITS, maxMeetingBytes: 64 * 1024 * 1024 },
      highWaterBytes: 256 * 1024,
    });
    try {
      const key = 'c'.repeat(64);
      const a = new WebSocket(`${relay.url}/v1/pair/${key}`);
      await new Promise((r) => a.addEventListener('open', r));
      const b = new WebSocket(`${relay.url}/v1/pair/${key}`);
      b.binaryType = 'arraybuffer';
      let got = 0;
      b.addEventListener('message', (e) => {
        if (typeof e.data !== 'string') got += (e.data as ArrayBuffer).byteLength;
      });
      await new Promise((r) => a.addEventListener('message', r));
      const chunk = new Uint8Array(TEST_LIMITS.maxFrameBytes);
      const total = 16 * 1024 * 1024;
      for (let sent = 0; sent < total; sent += chunk.byteLength) a.send(chunk);
      const deadline = Date.now() + 15_000;
      while (got < total && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      assert.equal(got, total);
      a.close();
    } finally {
      await relay.close();
    }
  });
});
