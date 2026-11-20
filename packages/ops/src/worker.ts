// The maintenance page: what Workspace's Cloudflare services carried and cost,
// for the one person allowed in by Cloudflare Access. One request, one page;
// nothing is stored.

import { verifyAccess } from './access.ts';
import { fetchUsage, freeShare, paidCost, sumByFunction, totals, type DayUsage, type FunctionUsage } from './usage.ts';

export interface Env {
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ALLOWED_EMAIL: string;
  /** Secret: a Cloudflare API token with Account Analytics Read. */
  CF_API_TOKEN?: string;
  /** The Cloudflare account the services run in. */
  CF_ACCOUNT_ID?: string;
  /** Optional JSON: Durable Object namespace id to the name shown for it. */
  NAMESPACE_LABELS?: string;
}

export type Period = 'today' | '7d' | 'month';
const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: 'month', label: 'This month' },
];

const day = (d: Date) => d.toISOString().slice(0, 10);

/** The first and last day (UTC) of `period`, ending `now`. */
export function rangeFor(period: Period, now: Date): { start: string; end: string } {
  const end = day(now);
  if (period === 'today') return { start: end, end };
  if (period === '7d') return { start: day(new Date(now.getTime() - 6 * 86_400_000)), end };
  return { start: `${end.slice(0, 8)}01`, end };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const num = (n: number) => Math.round(n).toLocaleString('en-GB');
const money = (n: number) => `$${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}`;
function bytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${i === 0 ? n : n.toFixed(1)} ${units[i]}`;
}
const pct = (s: number) => `${(s * 100).toFixed(s < 0.01 ? 2 : 1)}%`;

/** What each service is, in words, for a reader who didn't build it. */
const SERVICES: Record<string, { label: string; role: string }> = {
  'workspace-relay': {
    label: 'Relay',
    role: "Pairs two devices that can't reach each other directly and passes their encrypted traffic, unread.",
  },
  'workspace-ops': { label: 'This dashboard', role: 'This page.' },
  __unknown__: {
    label: 'Not tied to a service',
    role: "Requests Cloudflare couldn't attribute to a worker, such as calls to an address while a worker was being replaced.",
  },
};
const serviceOf = (name: string) => SERVICES[name] ?? { label: name, role: '' };

const minutes = (gbSeconds: number) => {
  const s = gbSeconds / 0.125;
  return s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
};

const STYLE = `
:root { color-scheme: light dark; --bg:#f6f6f4; --fg:#1d1d1f; --muted:#6b6b70; --line:#e3e3e6; --card:#ffffff; --warn:#b26100; --good:#2e7d32; }
@media (prefers-color-scheme: dark) { :root { --bg:#111113; --fg:#ececee; --muted:#9a9aa1; --line:#2a2a2f; --card:#1c1c1f; --warn:#f0a050; --good:#7bc77e; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-text-size-adjust: 100%; }
main { max-width: 720px; margin: 0 auto; padding: 20px 16px 48px; }
h1 { font-size: 24px; margin: 0; }
h2 { font-size: 17px; margin: 28px 0 10px; }
.who { color: var(--muted); font-size: 14px; margin-top: 2px; }
nav { display: flex; gap: 6px; margin: 16px 0 8px; flex-wrap: wrap; }
nav a { padding: 7px 14px; border-radius: 999px; text-decoration: none; color: var(--fg); border: 1px solid var(--line); font-size: 15px; }
nav a[aria-current] { background: var(--fg); color: var(--bg); border-color: var(--fg); }
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.tile { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; }
.tile b { display: block; font-size: 24px; font-variant-numeric: tabular-nums; }
.tile span { color: var(--muted); font-size: 13px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; margin-bottom: 10px; }
.card h3 { margin: 0; font-size: 17px; }
.card p { margin: 2px 0 10px; color: var(--muted); font-size: 14px; }
dl { margin: 0; display: grid; grid-template-columns: 1fr auto; row-gap: 6px; column-gap: 12px; font-variant-numeric: tabular-nums; }
dt { color: var(--muted); }
dd { margin: 0; text-align: right; }
.list { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 4px 16px; }
.row { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); font-variant-numeric: tabular-nums; }
.row:last-child { border-bottom: 0; }
.row small { display: block; color: var(--muted); font-size: 13px; }
.row .v { text-align: right; white-space: nowrap; }
.total { font-weight: 600; }
.over { color: var(--warn); font-weight: 600; }
.ok { color: var(--good); }
.note { color: var(--muted); font-size: 13px; margin: 8px 2px 0; }
.err { border: 1px solid var(--warn); border-radius: 14px; padding: 12px 14px; }
`;

function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' } },
  );
}

function tiles(fns: FunctionUsage[], monthCost: number): string {
  const workers = fns.filter((f) => f.kind === 'worker');
  const objects = fns.filter((f) => f.kind === 'durable-object');
  const opened = workers.reduce((n, f) => n + f.requests, 0);
  const awake = objects.reduce((n, f) => n + f.gbSeconds, 0);
  const sent = fns.reduce((n, f) => n + f.bytesOut, 0);
  return `<div class="tiles">
<div class="tile"><b>${num(opened)}</b><span>Connections opened</span></div>
<div class="tile"><b>${minutes(awake)}</b><span>Relay awake, billed</span></div>
<div class="tile"><b>${bytes(sent)}</b><span>Data sent</span></div>
<div class="tile"><b>${money(monthCost)}</b><span>Usage cost this month</span></div>
</div>`;
}

function serviceCards(fns: FunctionUsage[]): string {
  if (fns.length === 0) return '<p class="note">Nothing ran in this period.</p>';
  // Known services first, in the order they're listed; anything else after.
  const order = Object.keys(SERVICES);
  const rank = (f: FunctionUsage) => (order.includes(f.name) ? order.indexOf(f.name) : order.length - 0.5);
  return [...fns]
    .sort((a, b) => rank(a) - rank(b))
    .map((f) => {
      const s = serviceOf(f.name);
      const rows =
        f.kind === 'worker'
          ? [
              ['Connections opened', num(f.requests)],
              ['Failed', f.errors ? num(f.errors) : 'none'],
              ['Processing time', `${num(f.cpuMs)} ms`],
              ['Data sent', bytes(f.bytesOut)],
            ]
          : [
              ['Meetings and messages handled', num(f.requests)],
              ['Ended with an error', f.errors ? num(f.errors) : 'none'],
              ['Awake, billed', `${minutes(f.gbSeconds)} · ${num(f.gbSeconds)} GB-s`],
              ['Messages to devices', num(f.wsOut)],
              ...(f.wsIn ? [['Messages from devices', num(f.wsIn)]] : []),
              ['Data sent', bytes(f.bytesOut)],
            ];
      const what = f.kind === 'worker' ? 'Front door' : 'Meeting rooms';
      return `<div class="card"><h3>${esc(s.label)} · ${what}</h3><p>${esc(
        f.kind === 'worker' ? s.role : 'Where two devices meet: one room per pair, asleep and free while nothing passes.',
      )}</p><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></div>`;
    })
    .join('');
}

function costSection(month: DayUsage[], today: DayUsage | undefined): string {
  const paid = paidCost(totals(month.flatMap((d) => d.functions)));
  const lines = paid.lines
    .map(
      (l) =>
        `<div class="row"><div>${l.label}<small>${num(l.used)} of ${num(l.included)} included</small></div><div class="v${l.cost > 0 ? ' over' : ''}">${money(l.cost)}</div></div>`,
    )
    .join('');
  const free = freeShare(totals(today?.functions ?? []))
    .map(
      (r) =>
        `<div class="row"><div>${r.label}<small>${num(r.used)} of ${num(r.limit)} a day</small></div><div class="v ${r.share >= 0.8 ? 'over' : 'ok'}">${pct(r.share)}</div></div>`,
    )
    .join('');
  return `<h2>Cost this month</h2>
<div class="list">${lines}<div class="row total"><div>Usage charges</div><div class="v">${money(paid.usage)}</div></div><div class="row total"><div>With the $5 Workers Paid plan</div><div class="v">${money(paid.withFee)}</div></div></div>
<h2>Today, against the free plan</h2>
<div class="list">${free}</div>
<p class="note">Costs are worked out from Cloudflare's published prices, not read from the invoice. Days are UTC. Cloudflare reports bytes sent but not bytes received, and WebSocket traffic only as message counts.</p>`;
}

function byDay(days: DayUsage[]): string {
  if (days.length <= 1) return '';
  const rows = [...days]
    .reverse()
    .map((d) => {
      const t = totals(d.functions);
      const opened = d.functions.filter((f) => f.kind === 'worker').reduce((n, f) => n + f.requests, 0);
      return `<div class="row"><div>${new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}<small>${num(opened)} connections · ${bytes(t.bytesOut)} sent</small></div><div class="v">${minutes(t.doGbSeconds)} awake</div></div>`;
    })
    .join('');
  return `<h2>By day</h2><div class="list">${rows}</div>`;
}

export async function render(env: Env, email: string, period: Period, now: Date, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const nav = `<nav>${PERIODS.map((p) => `<a href="?p=${p.id}"${p.id === period ? ' aria-current="page"' : ''}>${p.label}</a>`).join('')}</nav>`;
  const head = `<h1>Workspace on Cloudflare</h1><div class="who">Signed in as ${esc(email)}</div>${nav}`;
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
    return page('Workspace ops', `${head}<p class="err">This page has no Cloudflare API token to read analytics with yet. Add a token with <b>Account Analytics: Read</b> as the secret <code>CF_API_TOKEN</code> on the <code>workspace-ops</code> worker.</p>`);
  }
  // One fetch covers every view: the month so far, and the last seven days.
  const month = rangeFor('month', now);
  const week = rangeFor('7d', now);
  const start = week.start < month.start ? week.start : month.start;
  let labels: Record<string, string> = {};
  try {
    labels = env.NAMESPACE_LABELS ? (JSON.parse(env.NAMESPACE_LABELS) as Record<string, string>) : {};
  } catch {
    labels = {};
  }
  let days: DayUsage[];
  try {
    days = await fetchUsage({ token: env.CF_API_TOKEN, accountId: env.CF_ACCOUNT_ID, start, end: month.end, labels, fetch: fetchImpl });
  } catch (error) {
    return page('Workspace ops', `${head}<p class="err">${esc(String(error instanceof Error ? error.message : error))}</p>`);
  }
  const range = rangeFor(period, now);
  const inPeriod = days.filter((d) => d.date >= range.start && d.date <= range.end);
  const inMonth = days.filter((d) => d.date >= month.start);
  const today = days.find((d) => d.date === month.end);
  const fns = sumByFunction(inPeriod);
  const monthCost = paidCost(totals(inMonth.flatMap((d) => d.functions))).usage;
  return page(
    'Workspace ops',
    `${head}${tiles(fns, monthCost)}<h2>By service</h2>${serviceCards(fns)}${byDay(inPeriod)}${costSection(inMonth, today)}`,
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/') return new Response('Not Found', { status: 404 });
    const verdict = await verifyAccess(request.headers.get('cf-access-jwt-assertion'), {
      teamDomain: env.ACCESS_TEAM_DOMAIN,
      aud: env.ACCESS_AUD,
      allowedEmail: env.ALLOWED_EMAIL,
    });
    if (!verdict.ok) return new Response('Forbidden', { status: 403 });
    const p = url.searchParams.get('p');
    const period: Period = p === 'today' || p === '7d' ? p : 'month';
    return render(env, verdict.email, period, new Date());
  },
};
