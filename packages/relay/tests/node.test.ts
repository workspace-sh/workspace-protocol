import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startRelayServer } from '../src/node.ts';
import { TEST_LIMITS, relaySuite } from './suite.ts';

relaySuite('plain process', () => startRelayServer({ limits: TEST_LIMITS }));

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
