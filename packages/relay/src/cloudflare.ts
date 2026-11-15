// The Cloudflare adapter: a Worker that routes each meeting key to its own
// Durable Object. The object accepts both WebSockets with the hibernation
// API, so an idle meeting costs nothing while it waits, and keeps each
// side's state in the socket's attachment so it survives hibernation.
//
// The free plan allows only SQLite-backed Durable Objects, which is what
// wrangler.toml declares (`new_sqlite_classes`). The relay stores nothing.

import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';
import {
  CLOSE,
  PAIRED,
  PROTOCOL_VERSION,
  admit,
  deadlineFor,
  limitsFrom,
  meetingKeyFrom,
  newSide,
  onFrame,
  type Limits,
  type Side,
} from './core.ts';

export interface Env {
  MEETINGS: DurableObjectNamespace<Meeting>;
  RELAY_WAIT_MS?: string;
  RELAY_MAX_FRAME_BYTES?: string;
  RELAY_MAX_MEETING_BYTES?: string;
  RELAY_MAX_MEETING_MS?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => c.text(`workspace relay, protocol ${PROTOCOL_VERSION}\n`));
app.get('/health', (c) => c.text(`workspace relay, protocol ${PROTOCOL_VERSION}\n`));

app.get('/v1/pair/:key', (c) => {
  const key = meetingKeyFrom(new URL(c.req.url).pathname);
  if (!key) return c.text('Not Found', 404);
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return c.text('expected a WebSocket', 426);
  const stub = c.env.MEETINGS.get(c.env.MEETINGS.idFromName(key));
  return stub.fetch(c.req.raw);
});

export default app;

export class Meeting extends DurableObject<Env> {
  private limits: Limits;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.limits = limitsFrom(env as unknown as Record<string, unknown>);
  }

  private open(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  private sideOf(ws: WebSocket): Side {
    return ws.deserializeAttachment() as Side;
  }

  private async scheduleAlarm(): Promise<void> {
    const deadlines = this.open().map((ws) => deadlineFor(this.sideOf(ws), this.limits).at);
    if (deadlines.length === 0) return void (await this.ctx.storage.deleteAlarm());
    await this.ctx.storage.setAlarm(Math.min(...deadlines));
  }

  override async fetch(_req: Request): Promise<Response> {
    const present = this.open();
    const verdict = admit(present.length);
    if (!verdict.ok) return new Response(verdict.reason, { status: verdict.status });

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    const now = Date.now();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(newSide(now));

    if (verdict.pairs) {
      for (const ws of [...present, server]) {
        ws.serializeAttachment({ ...this.sideOf(ws), pairedAt: now } satisfies Side);
        ws.send(PAIRED);
      }
    }
    await this.scheduleAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    const peers = this.open();
    const total = peers.reduce((n, p) => n + this.sideOf(p).bytes, 0);
    const binary = typeof message !== 'string';
    const size = binary ? message.byteLength : new TextEncoder().encode(message).byteLength;
    const v = onFrame(this.sideOf(ws), { binary, size }, total, this.limits);
    if (!v.forward) return this.end(ws, v.code, v.reason);
    ws.serializeAttachment(v.side);
    for (const other of peers) if (other !== ws) other.send(message);
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
    this.peerLeft(ws);
    await this.scheduleAlarm();
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.peerLeft(ws);
    await this.scheduleAlarm();
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    for (const ws of this.open()) {
      const d = deadlineFor(this.sideOf(ws), this.limits);
      if (d.at <= now) this.end(ws, d.code, d.reason);
    }
    await this.scheduleAlarm();
  }

  /** Closes one side and, with it, the meeting. */
  private end(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
    this.peerLeft(ws);
  }

  private peerLeft(gone: WebSocket): void {
    for (const other of this.open()) {
      if (other === gone) continue;
      try {
        other.close(CLOSE.PEER_LEFT, "peer left");
      } catch {
        // already closed
      }
    }
  }
}
