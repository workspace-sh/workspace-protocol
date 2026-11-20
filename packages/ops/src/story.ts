// What the relay did, in sentences a reader who didn't build it can follow,
// from the relay's daily totals (how meetings ended, summed time and bytes).

export interface DayTotals {
  outcomes: Partial<Record<string, number>>;
  met: number;
  waitedMs: number;
  connectedMs: number;
  bytes: number;
}

export function sumTotals(days: DayTotals[]): DayTotals {
  const t: DayTotals = { outcomes: {}, met: 0, waitedMs: 0, connectedMs: 0, bytes: 0 };
  for (const d of days) {
    for (const [k, n] of Object.entries(d.outcomes)) t.outcomes[k] = (t.outcomes[k] ?? 0) + (n ?? 0);
    t.met += d.met;
    t.waitedMs += d.waitedMs;
    t.connectedMs += d.connectedMs;
    t.bytes += d.bytes;
  }
  return t;
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export function bytesText(n: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${i === 0 ? n : n.toFixed(1)} ${units[i]}`;
}

const times = (n: number, one: string, many: string) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/** The period's story, one sentence per thing that happened, most important first. */
export function story(t: DayTotals): string[] {
  const n = (k: string) => t.outcomes[k] ?? 0;
  const meetings = Math.floor(t.met / 2);
  const out: string[] = [];
  if (meetings === 0 && t.met === 0 && Object.keys(t.outcomes).length === 0) {
    return ['Nothing used the relay in this period.'];
  }
  out.push(
    meetings > 0
      ? `Two devices met through the relay ${times(meetings, 'time', 'times')}. Together they stayed connected for ${duration(t.connectedMs / 2)} and passed ${bytesText(t.bytes)} of encrypted data the relay can't read.`
      : 'No two devices met through the relay.',
  );
  if (n('no_peer') > 0)
    out.push(
      `${times(n('no_peer'), 'time', 'times')} a device waited and the other never came, usually because the other device was offline or reached it directly instead. This is normal, and costs almost nothing.`,
    );
  if (n('gave_up') > 0) out.push(`${times(n('gave_up'), 'device', 'devices')} stopped waiting before the other arrived.`);
  if (n('silent') > 0)
    out.push(`${times(n('silent'), 'connection', 'connections')} ended because a device went quiet: it lost its network, or the app was put in the background.`);
  if (n('limit') > 0) out.push(`${times(n('limit'), 'connection', 'connections')} reached a size or time limit and were ended.`);
  if (n('protocol') > 0) out.push(`${times(n('protocol'), 'device', 'devices')} sent something the relay doesn't accept and were disconnected.`);
  if (n('dropped') > 0) out.push(`${times(n('dropped'), 'connection', 'connections')} dropped without saying goodbye.`);
  return out;
}
