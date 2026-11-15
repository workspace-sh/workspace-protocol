// The test suite every adapter passes. Each adapter's test file starts a
// relay with TEST_LIMITS and calls relaySuite with its base URL.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { CLOSE, PAIRED, type Limits } from '../src/core.ts';

export const TEST_LIMITS: Limits = {
  waitMs: 800,
  maxFrameBytes: 64 * 1024,
  maxMeetingBytes: 256 * 1024,
  maxMeetingMs: 60_000,
};

interface Client {
  ws: WebSocket;
  opened: Promise<boolean>;
  paired: Promise<void>;
  closed: Promise<{ code: number; reason: string }>;
  next(): Promise<Uint8Array>;
}

function connect(url: string): Client {
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  const inbox: Uint8Array[] = [];
  const waiting: ((b: Uint8Array) => void)[] = [];
  let onPaired!: () => void;
  const paired = new Promise<void>((r) => (onPaired = r));
  ws.addEventListener('message', (e) => {
    if (typeof e.data === 'string') {
      if (e.data === PAIRED) onPaired();
      return;
    }
    const bytes = new Uint8Array(e.data as ArrayBuffer);
    const w = waiting.shift();
    if (w) w(bytes);
    else inbox.push(bytes);
  });
  return {
    ws,
    opened: new Promise((r) => {
      ws.addEventListener('open', () => r(true));
      ws.addEventListener('close', () => r(false));
    }),
    paired,
    closed: new Promise((r) => ws.addEventListener('close', (e) => r({ code: e.code, reason: e.reason }))),
    next: () => {
      const b = inbox.shift();
      return b ? Promise.resolve(b) : new Promise((r) => waiting.push(r));
    },
  };
}

// Local workerd delivers a server's close frame at once but holds the TCP
// teardown for about ten seconds, and a WebSocket's close event waits for
// the teardown. Close waits allow for that.
const CLOSE_WAIT_MS = 15_000;

const newKey = () => randomBytes(32).toString('hex');

function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error(`timed out: ${what}`)), ms))]);
}

async function pair(base: string, key = newKey()): Promise<[Client, Client]> {
  const a = connect(`${base}/v1/pair/${key}`);
  assert.equal(await within(a.opened, 5000, 'first open'), true);
  const b = connect(`${base}/v1/pair/${key}`);
  assert.equal(await within(b.opened, 5000, 'second open'), true);
  await within(Promise.all([a.paired, b.paired]), 5000, 'paired');
  return [a, b];
}

export function relaySuite(name: string, start: () => Promise<{ url: string; close(): Promise<void> }>): void {
  describe(`relay: ${name}`, () => {
    let base = '';
    let stop: () => Promise<void> = async () => {};
    before(async () => {
      const r = await start();
      base = r.url;
      stop = () => r.close();
    });
    after(() => stop());

    it('pairs two devices and passes bytes both ways unchanged', async () => {
      const [a, b] = await pair(base);
      const one = randomBytes(1000);
      const two = randomBytes(5000);
      a.ws.send(one);
      b.ws.send(two);
      assert.deepEqual(Buffer.from(await within(b.next(), 3000, 'b receives')), one);
      assert.deepEqual(Buffer.from(await within(a.next(), 3000, 'a receives')), two);
      a.ws.close();
      await b.closed;
    });

    it('keeps frames in order', async () => {
      const [a, b] = await pair(base);
      for (let i = 0; i < 50; i++) a.ws.send(new Uint8Array([i]));
      for (let i = 0; i < 50; i++) assert.equal((await within(b.next(), 3000, `frame ${i}`))[0], i);
      a.ws.close();
      await b.closed;
    });

    it('refuses a third connection to a full meeting', async () => {
      const key = newKey();
      const [a, b] = await pair(base, key);
      const c = connect(`${base}/v1/pair/${key}`);
      assert.equal(await within(c.opened, CLOSE_WAIT_MS, 'third refused'), false);
      a.ws.close();
      await b.closed;
    });

    it('refuses a path without a valid meeting key', async () => {
      for (const path of ['/v1/pair/short', `/v1/pair/${newKey().toUpperCase()}`, `/v2/pair/${newKey()}`]) {
        const c = connect(`${base}${path}`);
        assert.equal(await within(c.opened, CLOSE_WAIT_MS, path), false, path);
      }
    });

    it('closes the other device when one leaves, and frees the key', async () => {
      const key = newKey();
      const [a, b] = await pair(base, key);
      a.ws.close(1000);
      const { code } = await within(b.closed, CLOSE_WAIT_MS, 'peer closed');
      assert.equal(code, CLOSE.PEER_LEFT);
      const [c, d] = await pair(base, key);
      c.ws.close();
      await d.closed;
    });

    it('closes a device that sends before it is paired', async () => {
      const a = connect(`${base}/v1/pair/${newKey()}`);
      await a.opened;
      a.ws.send(new Uint8Array([1]));
      assert.equal((await within(a.closed, CLOSE_WAIT_MS, 'closed')).code, CLOSE.PROTOCOL);
    });

    it('closes a device that sends a text frame', async () => {
      const [a, b] = await pair(base);
      a.ws.send('hello');
      assert.equal((await within(a.closed, CLOSE_WAIT_MS, 'sender closed')).code, CLOSE.PROTOCOL);
      assert.equal((await within(b.closed, CLOSE_WAIT_MS, 'peer closed')).code, CLOSE.PEER_LEFT);
    });

    it('closes a device whose peer never arrives', async () => {
      const a = connect(`${base}/v1/pair/${newKey()}`);
      await a.opened;
      const { code } = await within(a.closed, TEST_LIMITS.waitMs + CLOSE_WAIT_MS, 'wait limit');
      assert.equal(code, CLOSE.NO_PEER);
    });

    it('closes on a frame over the limit', async () => {
      const [a, b] = await pair(base);
      a.ws.send(new Uint8Array(TEST_LIMITS.maxFrameBytes + 1));
      assert.equal((await within(a.closed, CLOSE_WAIT_MS, 'sender closed')).code, CLOSE.LIMIT);
      await b.closed;
    });

    it('counts empty frames against the meeting limit', async () => {
      const [a, b] = await pair(base);
      // At 64 bytes each, 256 KiB allows 4096 empty frames.
      for (let i = 0; i < 5000; i++) a.ws.send(new Uint8Array(0));
      assert.equal((await within(a.closed, CLOSE_WAIT_MS, 'sender closed')).code, CLOSE.LIMIT);
      await b.closed;
    });

    it("closes when the meeting's bytes go over the limit", async () => {
      const [a, b] = await pair(base);
      const chunk = new Uint8Array(TEST_LIMITS.maxFrameBytes);
      const fits = Math.floor(TEST_LIMITS.maxMeetingBytes / chunk.byteLength);
      for (let i = 0; i < fits; i++) {
        a.ws.send(chunk);
        await within(b.next(), 3000, `chunk ${i}`);
      }
      a.ws.send(new Uint8Array([1]));
      assert.equal((await within(a.closed, CLOSE_WAIT_MS, 'sender closed')).code, CLOSE.LIMIT);
      await b.closed;
    });
  });
}
