// What Workspace's Cloudflare services carried and cost, from Cloudflare's
// GraphQL analytics: each Worker and each Durable Object namespace, per day.
//
// Costs are worked out from Cloudflare's published prices (Workers Paid,
// standard usage model), against what each plan includes. They are an
// estimate of usage charges, not the invoice: the invoice also has the
// plan's own fee and anything outside Workers.

export interface FunctionUsage {
  kind: 'worker' | 'durable-object';
  /** The script, or for a namespace the script that owns it when known. */
  name: string;
  requests: number;
  errors: number;
  cpuMs: number;
  /** Durable Objects only: billed duration, at 128 MB per active object. */
  gbSeconds: number;
  wsIn: number;
  wsOut: number;
  /** Response bytes sent (Cloudflare reports no request bytes for Workers). */
  bytesOut: number;
}

export interface DayUsage {
  date: string;
  functions: FunctionUsage[];
}

/** Workers Paid: what the plan includes each month, and the price beyond it. */
export const PAID = {
  fee: 5,
  workerRequests: { included: 10_000_000, perMillion: 0.3 },
  workerCpuMs: { included: 30_000_000, perMillion: 0.02 },
  doRequests: { included: 1_000_000, perMillion: 0.15 },
  doGbSeconds: { included: 400_000, perMillion: 12.5 },
} as const;

/** Workers Free: daily allowances; past them requests fail rather than cost. */
export const FREE_DAILY = {
  workerRequests: 100_000,
  doRequests: 100_000,
  doGbSeconds: 13_000,
} as const;

/** Incoming WebSocket messages are billed as requests at 20 to 1. */
export const WS_MESSAGES_PER_REQUEST = 20;

/** Durable Object duration is billed as if each active object used 128 MB. */
const GB_PER_OBJECT = 0.125;

export interface Totals {
  workerRequests: number;
  workerCpuMs: number;
  doRequests: number;
  doGbSeconds: number;
  bytesOut: number;
  errors: number;
}

export function totals(fns: FunctionUsage[]): Totals {
  const t: Totals = { workerRequests: 0, workerCpuMs: 0, doRequests: 0, doGbSeconds: 0, bytesOut: 0, errors: 0 };
  for (const f of fns) {
    t.bytesOut += f.bytesOut;
    t.errors += f.errors;
    if (f.kind === 'worker') {
      t.workerRequests += f.requests;
      t.workerCpuMs += f.cpuMs;
    } else {
      t.doRequests += f.requests + f.wsIn / WS_MESSAGES_PER_REQUEST;
      t.doGbSeconds += f.gbSeconds;
    }
  }
  return t;
}

export interface CostLine {
  label: string;
  used: number;
  included: number;
  cost: number;
}

/** Usage charges on Workers Paid for one month's totals; the plan fee is separate. */
export function paidCost(t: Totals): { lines: CostLine[]; usage: number; withFee: number } {
  const line = (label: string, used: number, p: { included: number; perMillion: number }): CostLine => ({
    label,
    used,
    included: p.included,
    cost: (Math.max(0, used - p.included) / 1_000_000) * p.perMillion,
  });
  const lines = [
    line('Worker requests', t.workerRequests, PAID.workerRequests),
    line('Worker CPU (ms)', t.workerCpuMs, PAID.workerCpuMs),
    line('Durable Object requests', t.doRequests, PAID.doRequests),
    line('Durable Object duration (GB-s)', t.doGbSeconds, PAID.doGbSeconds),
  ];
  const usage = lines.reduce((n, l) => n + l.cost, 0);
  return { lines, usage, withFee: usage + PAID.fee };
}

/** How much of each free daily allowance one day's totals used, 0 to 1 and beyond. */
export function freeShare(t: Totals): { label: string; used: number; limit: number; share: number }[] {
  return [
    { label: 'Worker requests', used: t.workerRequests, limit: FREE_DAILY.workerRequests },
    { label: 'Durable Object requests', used: t.doRequests, limit: FREE_DAILY.doRequests },
    { label: 'Durable Object duration (GB-s)', used: t.doGbSeconds, limit: FREE_DAILY.doGbSeconds },
  ].map((r) => ({ ...r, share: r.used / r.limit }));
}

/** One function's figures summed over days. */
export function sumByFunction(days: DayUsage[]): FunctionUsage[] {
  const by = new Map<string, FunctionUsage>();
  for (const d of days) {
    for (const f of d.functions) {
      const key = `${f.kind}:${f.name}`;
      const had = by.get(key);
      if (!had) by.set(key, { ...f });
      else
        for (const k of ['requests', 'errors', 'cpuMs', 'gbSeconds', 'wsIn', 'wsOut', 'bytesOut'] as const) had[k] += f[k];
    }
  }
  return [...by.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'worker' ? -1 : 1));
}

const QUERY = `query Usage($a: String!, $s: Date!, $e: Date!) {
  viewer { accounts(filter: { accountTag: $a }) {
    w: workersInvocationsAdaptive(limit: 10000, filter: { date_geq: $s, date_leq: $e }) {
      sum { requests errors cpuTimeUs responseBodySize } dimensions { scriptName date }
    }
    di: durableObjectsInvocationsAdaptiveGroups(limit: 10000, filter: { date_geq: $s, date_leq: $e }) {
      sum { requests errors responseBodySize } dimensions { scriptName date }
    }
    dp: durableObjectsPeriodicGroups(limit: 10000, filter: { date_geq: $s, date_leq: $e }) {
      sum { activeTime cpuTime inboundWebsocketMsgCount outboundWebsocketMsgCount } dimensions { namespaceId date }
    }
  } }
}`;

interface Raw {
  w: { sum: { requests: number; errors: number; cpuTimeUs: number; responseBodySize: number }; dimensions: { scriptName: string; date: string } }[];
  di: { sum: { requests: number; errors: number; responseBodySize: number }; dimensions: { scriptName: string; date: string } }[];
  dp: {
    sum: { activeTime: number; cpuTime: number; inboundWebsocketMsgCount: number; outboundWebsocketMsgCount: number };
    dimensions: { namespaceId: string; date: string };
  }[];
}

/** Turns the three analytics groups into per-day usage, keyed by namespace id in `labels`. */
export function fromRaw(raw: Raw, labels: Record<string, string> = {}): DayUsage[] {
  const days = new Map<string, Map<string, FunctionUsage>>();
  const get = (date: string, kind: FunctionUsage['kind'], name: string): FunctionUsage => {
    let d = days.get(date);
    if (!d) days.set(date, (d = new Map()));
    const key = `${kind}:${name}`;
    let f = d.get(key);
    if (!f) d.set(key, (f = { kind, name, requests: 0, errors: 0, cpuMs: 0, gbSeconds: 0, wsIn: 0, wsOut: 0, bytesOut: 0 }));
    return f;
  };
  for (const r of raw.w) {
    const f = get(r.dimensions.date, 'worker', r.dimensions.scriptName);
    f.requests += r.sum.requests;
    f.errors += r.sum.errors;
    f.cpuMs += r.sum.cpuTimeUs / 1000;
    f.bytesOut += r.sum.responseBodySize;
  }
  // Requests and response bytes are counted by script; duration and messages
  // by namespace. A namespace is shown under its script's name: from `labels`,
  // or the one script with Durable Objects when there is only one.
  const doScripts = new Set(raw.di.map((r) => r.dimensions.scriptName));
  const only = doScripts.size === 1 ? [...doScripts][0]! : null;
  for (const r of raw.di) {
    const f = get(r.dimensions.date, 'durable-object', r.dimensions.scriptName);
    f.requests += r.sum.requests;
    f.errors += r.sum.errors;
    f.bytesOut += r.sum.responseBodySize;
  }
  for (const r of raw.dp) {
    const id = r.dimensions.namespaceId;
    const f = get(r.dimensions.date, 'durable-object', labels[id] ?? only ?? `namespace ${id.slice(0, 8)}`);
    f.cpuMs += r.sum.cpuTime / 1000;
    f.gbSeconds += (r.sum.activeTime / 1_000_000) * GB_PER_OBJECT;
    f.wsIn += r.sum.inboundWebsocketMsgCount;
    f.wsOut += r.sum.outboundWebsocketMsgCount;
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, m]) => ({ date, functions: [...m.values()] }));
}

/** Fetches usage for the days from `start` to `end` (YYYY-MM-DD, UTC). */
export async function fetchUsage(opts: {
  token: string;
  accountId: string;
  start: string;
  end: string;
  labels?: Record<string, string>;
  fetch?: typeof fetch;
}): Promise<DayUsage[]> {
  const r = await (opts.fetch ?? fetch)('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { a: opts.accountId, s: opts.start, e: opts.end } }),
  });
  if (!r.ok) throw new Error(`Cloudflare analytics: HTTP ${r.status}`);
  const body = (await r.json()) as { data?: { viewer: { accounts: Raw[] } }; errors?: { message: string }[] | null };
  if (body.errors?.length) throw new Error(`Cloudflare analytics: ${body.errors.map((e) => e.message).join('; ')}`);
  const raw = body.data?.viewer.accounts[0];
  if (!raw) throw new Error('Cloudflare analytics: no such account, or the token cannot read it');
  return fromRaw(raw, opts.labels);
}

/**
 * The month's usage if the rest of it goes as it has so far: the totals to
 * date, scaled to the whole month by the share of it that has passed.
 */
export function projectMonth(t: Totals, now: Date): Totals {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const k = (end - start) / Math.max(now.getTime() - start, 3_600_000);
  return {
    workerRequests: t.workerRequests * k,
    workerCpuMs: t.workerCpuMs * k,
    doRequests: t.doRequests * k,
    doGbSeconds: t.doGbSeconds * k,
    bytesOut: t.bytesOut * k,
    errors: t.errors * k,
  };
}
