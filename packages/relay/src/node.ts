// The plain-process adapter: the relay as an ordinary Node server, for a VPS
// or any always-on machine. Put TLS in front of it (a reverse proxy such as
// Caddy) for wss://.

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import {
  CLOSE,
  DEFAULT_LIMITS,
  PAIRED,
  PING,
  PONG,
  PROTOCOL_VERSION,
  admit,
  deadlineFor,
  meetingKeyFrom,
  newSide,
  onFrame,
  type Limits,
  type Side,
} from './core.ts';

export interface RelayServerOptions {
  port?: number;
  host?: string;
  limits?: Partial<Limits>;
  /** Meetings open at once, waiting or paired; more are refused with 503. */
  maxMeetings?: number;
  /** Bytes queued towards a slow device before the sender is paused. */
  highWaterBytes?: number;
  /** Connections open at once from one address; more are refused with 429. */
  maxPerAddress?: number;
  /**
   * Behind a reverse proxy, the header that carries the client's address
   * (e.g. 'x-forwarded-for'). Only set this when the proxy overwrites it;
   * otherwise a client can name any address it likes.
   */
  addressHeader?: string;
}

export interface RelayServer {
  /** The base URL, e.g. ws://127.0.0.1:8787 */
  url: string;
  /** Meetings currently open, for tests and status. */
  meetings(): number;
  close(): Promise<void>;
}

interface Member {
  ws: WebSocket;
  side: Side;
  /** When this side last sent a heartbeat, or null if it never has. */
  pingedAt: number | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export async function startRelayServer(opts: RelayServerOptions = {}): Promise<RelayServer> {
  const limits: Limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const maxMeetings = opts.maxMeetings ?? 10_000;
  const highWater = opts.highWaterBytes ?? 4 * 1024 * 1024;
  const maxPerAddress = opts.maxPerAddress ?? 16;
  const perAddress = new Map<string, number>();
  const meetings = new Map<string, Member[]>();
  const addressOf = (req: IncomingMessage): string => {
    if (opts.addressHeader) {
      const raw = req.headers[opts.addressHeader.toLowerCase()];
      const first = (Array.isArray(raw) ? raw[0] : raw)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? 'unknown';
  };
  // ws's own cap is a memory guard only; core's limit decides, so the close code is CLOSE.LIMIT.
  const wss = new WebSocketServer({ noServer: true, maxPayload: limits.maxFrameBytes * 2 + 1024 });

  const server: Server = createServer((req, res) => {
    if (req.url === '/' || req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`workspace relay, protocol ${PROTOCOL_VERSION}\n`);
      return;
    }
    res.writeHead(404).end();
  });

  const refuse = (socket: Duplex, status: number, reason: string) => {
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`);
  };

  const schedule = (m: Member) => {
    if (m.timer) clearTimeout(m.timer);
    const d = deadlineFor(m.side, limits, m.pingedAt);
    m.timer = setTimeout(() => m.ws.close(d.code, d.reason), Math.max(0, d.at - Date.now()));
    m.timer.unref?.();
  };

  const leave = (key: string, m: Member) => {
    if (m.timer) clearTimeout(m.timer);
    const list = meetings.get(key);
    if (!list?.includes(m)) return;
    // A meeting ends when either side leaves: the other is told and closed,
    // and the key is free again at once.
    meetings.delete(key);
    for (const other of list) {
      if (other === m) continue;
      if (other.timer) clearTimeout(other.timer);
      other.ws.close(CLOSE.PEER_LEFT, 'peer left');
    }
  };

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(req.url ?? '/', 'http://relay').pathname;
    const key = meetingKeyFrom(path);
    if (!key) return refuse(socket, 404, 'Not Found');
    const address = addressOf(req);
    if ((perAddress.get(address) ?? 0) >= maxPerAddress) return refuse(socket, 429, 'Too Many Requests');
    const present = meetings.get(key)?.length ?? 0;
    if (present === 0 && meetings.size >= maxMeetings) return refuse(socket, 503, 'Service Unavailable');
    const verdict = admit(present);
    if (!verdict.ok) return refuse(socket, verdict.status, 'Conflict');

    wss.handleUpgrade(req, socket, head, (ws) => {
      // Re-check: another connection may have taken the place meanwhile.
      const list = meetings.get(key) ?? [];
      const again = admit(list.length);
      if (!again.ok) return ws.close(CLOSE.PROTOCOL, again.reason);

      perAddress.set(address, (perAddress.get(address) ?? 0) + 1);
      ws.once('close', () => {
        const n = (perAddress.get(address) ?? 1) - 1;
        if (n <= 0) perAddress.delete(address);
        else perAddress.set(address, n);
      });

      const now = Date.now();
      const me: Member = { ws, side: newSide(now), pingedAt: null, timer: null };
      list.push(me);
      meetings.set(key, list);

      if (again.pairs) {
        for (const m of list) {
          m.side = { ...m.side, pairedAt: now };
          m.ws.send(PAIRED);
          schedule(m);
        }
      } else {
        schedule(me);
      }

      ws.on('message', (data: RawData, isBinary: boolean) => {
        if (!isBinary && !Array.isArray(data) && (data as Buffer).byteLength === PING.length && data.toString() === PING) {
          me.pingedAt = Date.now();
          ws.send(PONG);
          schedule(me);
          return;
        }
        const peers = meetings.get(key) ?? [];
        const total = peers.reduce((n, m) => n + m.side.bytes, 0);
        const size = Array.isArray(data) ? data.reduce((n, b) => n + b.length, 0) : (data as Buffer).byteLength;
        const v = onFrame(me.side, { binary: isBinary, size }, total, limits);
        if (!v.forward) return ws.close(v.code, v.reason);
        me.side = v.side;
        for (const other of peers) {
          if (other === me) continue;
          // Backpressure: a fast sender is paused while a slow device's queue
          // is over the high-water mark, so the relay never holds much.
          other.ws.send(data, { binary: true }, () => {
            if (ws.isPaused && other.ws.bufferedAmount < highWater / 2) ws.resume();
          });
          if (other.ws.bufferedAmount > highWater && !ws.isPaused) ws.pause();
        }
      });
      ws.on('close', () => leave(key, me));
      ws.on('error', () => ws.terminate());
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, opts.host ?? '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;
  const host = opts.host && opts.host !== '0.0.0.0' ? opts.host : '127.0.0.1';

  return {
    url: `ws://${host}:${port}`,
    meetings: () => meetings.size,
    close: () =>
      new Promise<void>((resolve) => {
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        server.close(() => resolve());
      }),
  };
}
