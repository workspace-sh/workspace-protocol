// The Cloudflare adapter: a Worker that routes each meeting key to its own
// Durable Object. The object accepts both WebSockets with the hibernation
// API, so an idle meeting costs nothing while it waits, and keeps each
// side's state in the socket's attachment so it survives hibernation.
// Heartbeats are answered by Cloudflare itself (an auto-response), so a
// device's pings never wake the object; the alarm reads when each side last
// pinged and lets a silent one go.
//
// The free plan allows only SQLite-backed Durable Objects, which is what
// wrangler.toml declares (`new_sqlite_classes`). The relay stores nothing.

import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';
import {
  CLOSE,
  PAIRED,
  PING,
  PONG,
  PROTOCOL_VERSION,
  admit,
  deadlineFor,
  limitsFrom,
  addEvent,
  dayOf,
  emptyTotals,
  expiredDays,
  meetingEvent,
  outcomeOfClose,
  meetingKeyFrom,
  newSide,
  onFrame,
  type Limits,
  type DayTotals,
  type MeetingEvent,
  type Outcome,
  type Side,
} from './core.ts';

export interface Env {
  MEETINGS: DurableObjectNamespace<Meeting>;
  RELAY_WAIT_MS?: string;
  RELAY_MAX_FRAME_BYTES?: string;
  RELAY_MAX_MEETING_BYTES?: string;
  RELAY_MAX_MEETING_MS?: string;
  RELAY_SILENCE_MS?: string;
  /** Daily totals of how meetings ended (one object). Optional: without it nothing is counted. */
  TOTALS?: DurableObjectNamespace<Totals>;
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
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  private open(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  private sideOf(ws: WebSocket): Side {
    return ws.deserializeAttachment() as Side;
  }

  private deadlineOf(ws: WebSocket) {
    const pinged = this.ctx.getWebSocketAutoResponseTimestamp(ws);
    return deadlineFor(this.sideOf(ws), this.limits, pinged ? pinged.getTime() : null);
  }

  private async scheduleAlarm(): Promise<void> {
    const deadlines = this.open().map((ws) => this.deadlineOf(ws).at);
    if (deadlines.length === 0) return void (await this.ctx.storage.deleteAlarm());
    // Pings never wake the object, so it cannot tell when a side starts or
    // stops sending them: it looks again at least once per silence limit.
    await this.ctx.storage.setAlarm(Math.min(...deadlines, Date.now() + this.limits.silenceMs));
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

  /**
   * Counts how a side ended, once, into the day's totals. Only sums are
   * kept: nothing names the meeting or the device, and no event is stored.
   */
  private record(ws: WebSocket, outcome: Outcome): void {
    const side = this.sideOf(ws);
    if (!side || side.ended) return;
    try {
      ws.serializeAttachment({ ...side, ended: true } satisfies Side);
    } catch {
      // closed: its attachment can no longer change, and it ends here anyway
    }
    const e = meetingEvent(side, outcome, Date.now());
    const totals = this.env.TOTALS;
    if (!totals) return;
    // Not awaited by the close: counting never holds up a meeting ending.
    this.ctx.waitUntil(totals.get(totals.idFromName('all')).add(e).catch(() => undefined));
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.record(ws, this.sideOf(ws)?.pairedAt != null ? 'left' : 'gave_up');
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
    this.peerLeft(ws);
    await this.scheduleAlarm();
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.record(ws, 'dropped');
    this.peerLeft(ws);
    await this.scheduleAlarm();
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    for (const ws of this.open()) {
      const d = this.deadlineOf(ws);
      if (d.at <= now) this.end(ws, d.code, d.reason);
    }
    await this.scheduleAlarm();
  }

  /** Closes one side and, with it, the meeting. */
  private end(ws: WebSocket, code: number, reason: string): void {
    this.record(ws, outcomeOfClose(code));
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
      this.record(other, 'peer_left');
      try {
        other.close(CLOSE.PEER_LEFT, "peer left");
      } catch {
        // already closed
      }
    }
  }
}

/**
 * The relay's only record: per UTC day, how many sides ended each way, how
 * many met, and the summed waiting, connected time and bytes. Days older than
 * TOTALS_KEEP_DAYS are deleted. Read by the maintenance page through its own
 * binding; there is no public address for it.
 */
export class Totals extends DurableObject<Env> {
  async add(e: MeetingEvent): Promise<void> {
    const now = Date.now();
    const key = `day:${dayOf(now)}`;
    const had = (await this.ctx.storage.get<DayTotals>(key)) ?? emptyTotals();
    await this.ctx.storage.put(key, addEvent(had, e));
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(now + 86_400_000);
  }

  /** The kept days, oldest first. */
  async days(): Promise<{ day: string; totals: DayTotals }[]> {
    const all = await this.ctx.storage.list<DayTotals>({ prefix: 'day:' });
    return [...all.entries()].map(([k, totals]) => ({ day: k.slice(4), totals }));
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    const days = [...(await this.ctx.storage.list({ prefix: 'day:' })).keys()].map((k) => k.slice(4));
    const old = expiredDays(days, now);
    if (old.length > 0) await this.ctx.storage.delete(old.map((d) => `day:${d}`));
    if (days.length > old.length) await this.ctx.storage.setAlarm(now + 86_400_000);
  }
}
