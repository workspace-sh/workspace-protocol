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

const STYLE = `
:root { color-scheme: light dark; --bg:#fbfbfa; --fg:#1d1d1f; --muted:#6b6b70; --line:#e3e3e6; --card:#ffffff; --accent:#2f6fde; --warn:#b26100; }
@media (prefers-color-scheme: dark) { :root { --bg:#141416; --fg:#ececee; --muted:#9a9aa1; --line:#2c2c31; --card:#1c1c1f; --accent:#7aa7ff; --warn:#f0a050; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 24px 16px 48px; }
header { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; justify-content: space-between; }
h1 { font-size: 20px; margin: 0; }
h2 { font-size: 15px; margin: 28px 0 8px; }
.who { color: var(--muted); font-size: 13px; }
nav { display: flex; gap: 4px; margin: 16px 0 4px; flex-wrap: wrap; }
nav a { padding: 5px 12px; border-radius: 999px; text-decoration: none; color: var(--fg); border: 1px solid var(--line); font-size: 13px; }
nav a[aria-current] { background: var(--fg); color: var(--bg); border-color: var(--fg); }
.scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { padding: 7px 12px; text-align: right; white-space: nowrap; border-bottom: 1px solid var(--line); }
tr:last-child td { border-bottom: 0; }
th { font-weight: 600; font-size: 12px; color: var(--muted); }
th:first-child, td:first-child { text-align: left; }
td.kind { color: var(--muted); font-size: 12px; text-align: left; }
tfoot td { font-weight: 600; border-top: 1px solid var(--line); }
.over { color: var(--warn); font-weight: 600; }
.note { color: var(--muted); font-size: 13px; margin: 8px 2px 0; }
.err { border: 1px solid var(--warn); border-radius: 10px; padding: 12px 14px; }
`;

function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' } },
  );
}

function functionsTable(fns: FunctionUsage[]): string {
  if (fns.length === 0) return '<p class="note">Nothing ran in this period.</p>';
  const rows = fns
    .map(
      (f) => `<tr><td>${esc(f.name)}</td><td class="kind">${f.kind === 'worker' ? 'Worker' : 'Durable Objects'}</td>
<td>${num(f.requests)}</td><td>${f.errors ? num(f.errors) : '–'}</td><td>${num(f.cpuMs)}</td>
<td>${f.kind === 'worker' ? '–' : num(f.gbSeconds)}</td><td>${f.kind === 'worker' ? '–' : num(f.wsIn)}</td><td>${f.kind === 'worker' ? '–' : num(f.wsOut)}</td><td>${bytes(f.bytesOut)}</td></tr>`,
    )
    .join('');
  const t = fns.reduce(
    (a, f) => ({ requests: a.requests + f.requests, errors: a.errors + f.errors, cpuMs: a.cpuMs + f.cpuMs, gb: a.gb + f.gbSeconds, wsIn: a.wsIn + f.wsIn, wsOut: a.wsOut + f.wsOut, out: a.out + f.bytesOut }),
    { requests: 0, errors: 0, cpuMs: 0, gb: 0, wsIn: 0, wsOut: 0, out: 0 },
  );
  return `<div class="scroll"><table><thead><tr><th>Service</th><th>Kind</th><th>Requests</th><th>Errors</th><th>CPU (ms)</th><th>Active (GB-s)</th><th>WS in</th><th>WS out</th><th>Sent</th></tr></thead>
<tbody>${rows}</tbody><tfoot><tr><td>All</td><td></td><td>${num(t.requests)}</td><td>${t.errors ? num(t.errors) : '–'}</td><td>${num(t.cpuMs)}</td><td>${num(t.gb)}</td><td>${num(t.wsIn)}</td><td>${num(t.wsOut)}</td><td>${bytes(t.out)}</td></tr></tfoot></table></div>`;
}

function costSection(month: DayUsage[], today: DayUsage | undefined): string {
  const paid = paidCost(totals(month.flatMap((d) => d.functions)));
  const paidRows = paid.lines
    .map((l) => `<tr><td>${l.label}</td><td>${num(l.used)}</td><td>${num(l.included)}</td><td>${money(l.cost)}</td></tr>`)
    .join('');
  const free = freeShare(totals(today?.functions ?? []));
  const freeRows = free
    .map((r) => `<tr><td>${r.label}</td><td>${num(r.used)}</td><td>${num(r.limit)}</td><td${r.share >= 0.8 ? ' class="over"' : ''}>${pct(r.share)}</td></tr>`)
    .join('');
  return `<h2>Cost this month, on the $5 Workers Paid plan</h2>
<div class="scroll"><table><thead><tr><th>Usage</th><th>Used</th><th>Included</th><th>Over, charged</th></tr></thead><tbody>${paidRows}</tbody>
<tfoot><tr><td>Usage charges</td><td></td><td></td><td>${money(paid.usage)}</td></tr><tr><td>With the plan's $5</td><td></td><td></td><td>${money(paid.withFee)}</td></tr></tfoot></table></div>
<h2>Today against the free plan's daily allowance</h2>
<div class="scroll"><table><thead><tr><th>Usage</th><th>Used today</th><th>Daily allowance</th><th>Share</th></tr></thead><tbody>${freeRows}</tbody></table></div>
<p class="note">Worked out from Cloudflare's published prices, not read from the invoice. Durable Object requests include incoming WebSocket messages at 20 to 1. Days are UTC.</p>`;
}

function byDay(days: DayUsage[]): string {
  if (days.length <= 1) return '';
  const rows = [...days]
    .reverse()
    .map((d) => {
      const t = totals(d.functions);
      return `<tr><td>${d.date}</td><td>${num(t.workerRequests)}</td><td>${num(t.doRequests)}</td><td>${num(t.doGbSeconds)}</td><td>${t.errors ? num(t.errors) : '–'}</td><td>${bytes(t.bytesOut)}</td></tr>`;
    })
    .join('');
  return `<h2>By day</h2><div class="scroll"><table><thead><tr><th>Day</th><th>Worker requests</th><th>DO requests</th><th>DO active (GB-s)</th><th>Errors</th><th>Sent</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export async function render(env: Env, email: string, period: Period, now: Date, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const nav = `<nav>${PERIODS.map((p) => `<a href="?p=${p.id}"${p.id === period ? ' aria-current="page"' : ''}>${p.label}</a>`).join('')}</nav>`;
  const head = `<header><h1>Workspace on Cloudflare</h1><span class="who">Signed in as ${esc(email)}</span></header>${nav}`;
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
  const label = PERIODS.find((p) => p.id === period)!.label;
  return page(
    'Workspace ops',
    `${head}<h2>${label}: by service</h2>${functionsTable(sumByFunction(inPeriod))}
<p class="note">Sent is response bytes as Cloudflare reports them; it reports no bytes received, and WebSocket traffic only as message counts.</p>
${byDay(inPeriod)}${costSection(inMonth, today)}`,
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
