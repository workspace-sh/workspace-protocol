// The maintenance page: what Workspace's Cloudflare services carried and cost,
// for the one person allowed in by Cloudflare Access. One request, one page;
// nothing is stored.

import { verifyAccess } from './access.ts';
import { fetchUsage, freeShare, paidCost, projectMonth, sumByFunction, totals, type DayUsage, type FunctionUsage } from './usage.ts';
import { glance, sumTotals, type Block, type DayTotals } from './story.ts';

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
  /** The relay's daily totals of how meetings ended (its Totals object). */
  TOTALS?: DurableObjectNamespace;
}

/** Reads the relay's kept days; none when the binding is missing or fails. */
async function relayDays(env: Env): Promise<{ day: string; totals: DayTotals }[]> {
  if (!env.TOTALS) return [];
  try {
    const stub = env.TOTALS.get(env.TOTALS.idFromName('all')) as unknown as { days(): Promise<{ day: string; totals: DayTotals }[]> };
    return await stub.days();
  } catch {
    return [];
  }
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
const money = (n: number) => `<span data-usd="${n}">$${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}</span>`;
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
.tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.tile { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; }
.tile b { display: block; font-size: 24px; font-variant-numeric: tabular-nums; }
.tile span { color: var(--muted); font-size: 13px; }
.tile b span { color: inherit; font-size: inherit; }
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
.blocks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.block { min-width: 0; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; display: flex; flex-direction: column; gap: 4px; }
.block .top { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.block .label { color: var(--muted); font-size: 13px; }
.block .value { font-size: 24px; font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1.2; overflow-wrap: anywhere; }
.chip { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.chip.good { background: color-mix(in srgb, var(--good) 18%, transparent); color: var(--good); }
.chip.watch { background: color-mix(in srgb, var(--warn) 20%, transparent); color: var(--warn); }
.chip.normal { background: color-mix(in srgb, var(--fg) 10%, transparent); color: var(--muted); }
.chip.idle { background: transparent; color: var(--muted); border: 1px solid var(--line); }
.meter { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; margin-top: 6px; }
.meter i { display: block; height: 100%; background: var(--good); }
.meter i.watch { background: var(--warn); }
details { margin-top: 10px; color: var(--muted); font-size: 14px; }
details summary { cursor: pointer; }
details dl { margin-top: 8px; display: block; }
details dt { color: var(--fg); margin-top: 8px; }
details dd { text-align: left; margin: 2px 0 0; }
.story { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 2px 16px; }
.story p { margin: 12px 0; }
.bar { display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin: 4px 0 10px; }
select { font: inherit; padding: 5px 8px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--fg); }
.seg { display: inline-flex; }
.seg a { padding: 6px 12px; border: 1px solid var(--line); text-decoration: none; color: var(--fg); font-size: 14px; }
.seg a:first-child { border-radius: 999px 0 0 999px; }
.seg a:last-child { border-radius: 0 999px 999px 0; border-left: 0; }
.seg a[aria-current] { background: var(--fg); color: var(--bg); }
`;

/**
 * Shows every amount in the chosen currency. Rates come from a free public
 * service (Frankfurter: European Central Bank rates), asked by the reader's
 * browser; the page itself holds US dollars only, as Cloudflare bills.
 */
const CURRENCY_SCRIPT = `
(() => {
  const pick = document.getElementById('currency');
  if (!pick) return;
  let rates = { USD: 1 };
  const show = (code) => {
    const rate = rates[code];
    if (!rate) return;
    const f = new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: 2 });
    for (const el of document.querySelectorAll('[data-usd]')) {
      const v = Number(el.dataset.usd) * rate;
      el.textContent = v > 0 && v < 0.01 ? '< ' + f.format(0.01) : f.format(v);
    }
  };
  let saved = 'USD';
  try { saved = localStorage.getItem('currency') || 'USD'; } catch {}
  pick.value = saved;
  pick.addEventListener('change', () => { try { localStorage.setItem('currency', pick.value); } catch {} show(pick.value); });
  fetch('https://api.frankfurter.dev/v1/latest?base=USD')
    .then((r) => r.json())
    .then((d) => { rates = { USD: 1, ...d.rates }; show(pick.value); })
    .catch(() => { pick.disabled = true; pick.title = 'Exchange rates are unavailable; amounts are in US dollars.'; });
})();
`;

function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${body}</main><script>${CURRENCY_SCRIPT}</script></body></html>`,
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

export type Plan = 'free' | 'paid';

function blockHtml(b: { label: string; value: string; state: string; word: string }, extra = ''): string {
  return `<div class="block"><div class="top"><span class="label">${esc(b.label)}</span><span class="chip ${b.state}">${esc(b.word)}</span></div><div class="value">${b.value}</div>${extra}</div>`;
}

function meanings(items: { label: string; meaning: string }[]): string {
  return `<details><summary>What these mean</summary><dl>${items.map((i) => `<dt>${esc(i.label)}</dt><dd>${esc(i.meaning)}</dd>`).join('')}</dl></details>`;
}

function costSection(month: DayUsage[], today: DayUsage | undefined, plan: Plan, period: Period, now: Date): string {
  const sofar = totals(month.flatMap((d) => d.functions));
  const projected = projectMonth(sofar, now);
  const toggle = `<span class="seg">${(['free', 'paid'] as const)
    .map((p) => `<a href="?p=${period}&plan=${p}"${p === plan ? ' aria-current="page"' : ''}>${p === 'free' ? 'Free plan' : '$5 plan'}</a>`)
    .join('')}</span>`;
  const currency = `<select id="currency" aria-label="Currency">${['USD', 'GBP', 'EUR', 'CAD', 'AUD', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'INR', 'ZAR']
    .map((c) => `<option>${c}</option>`)
    .join('')}</select>`;
  const head = `<h2>Cost</h2><div class="bar">${toggle}${currency}</div>`;
  if (plan === 'free') {
    const shares = freeShare(totals(today?.functions ?? []));
    const worst = Math.max(...shares.map((r) => r.share));
    const blocks = [
      blockHtml({ label: 'Cost', value: money(0), state: 'good', word: 'Free' }),
      blockHtml({ label: 'Busiest allowance today', value: pct(worst), state: worst >= 0.8 ? 'watch' : 'good', word: worst >= 0.8 ? 'Near limit' : 'Plenty left' }),
      ...shares.map((r) =>
        blockHtml(
          { label: r.label, value: pct(r.share), state: r.share >= 0.8 ? 'watch' : 'normal', word: `of ${num(r.limit)}` },
          `<div class="meter"><i class="${r.share >= 0.8 ? 'watch' : ''}" style="width:${Math.min(100, r.share * 100).toFixed(1)}%"></i></div>`,
        ),
      ),
    ].join('');
    return `${head}<div class="blocks">${blocks}</div>${meanings([
      { label: 'Free plan', meaning: 'Costs nothing. Each day has an allowance; past it, new connections are refused until midnight UTC instead of being charged.' },
      { label: 'Busiest allowance today', meaning: 'The fullest of the three daily allowances. Above 80% it is marked.' },
    ])}${costNote}`;
  }
  const now$ = paidCost(sofar);
  const end$ = paidCost(projected);
  const worst = Math.max(...freeShare(totals(today?.functions ?? [])).map((r) => r.share));
  const blocks = [
    blockHtml(
      { label: 'Free tier today', value: pct(worst), state: worst >= 1 ? 'watch' : worst >= 0.8 ? 'watch' : 'good', word: worst >= 1 ? 'Past it' : worst >= 0.8 ? 'Near it' : 'Within it' },
      `<div class="meter"><i class="${worst >= 0.8 ? 'watch' : ''}" style="width:${Math.min(100, worst * 100).toFixed(1)}%"></i></div>`,
    ),
    blockHtml({ label: 'Projected this month', value: money(end$.withFee), state: end$.usage > 0 ? 'watch' : 'good', word: end$.usage > 0 ? 'Over plan' : 'Within plan' }),
    blockHtml({ label: 'So far this month', value: money(now$.withFee), state: 'normal', word: 'To date' }),
    blockHtml({ label: 'Plan fee', value: money(5), state: 'normal', word: 'Fixed' }),
    blockHtml({ label: 'Use beyond the plan', value: money(end$.usage), state: end$.usage > 0 ? 'watch' : 'good', word: end$.usage > 0 ? 'Charged' : 'None' }),
    ...end$.lines.map((l) => {
      const share = l.used / l.included;
      return blockHtml(
        { label: l.label, value: pct(share), state: share >= 0.8 ? 'watch' : 'normal', word: 'of included' },
        `<div class="meter"><i class="${share >= 0.8 ? 'watch' : ''}" style="width:${Math.min(100, share * 100).toFixed(1)}%"></i></div>`,
      );
    }),
  ].join('');
  return `${head}<div class="blocks">${blocks}</div>${meanings([
    { label: 'Free tier today', meaning: "How much of the free plan's daily allowance today's use would take, counting its fullest part. Under 100% means today would have cost nothing on the free plan." },
    { label: 'Projected this month', meaning: 'What the month will cost if the rest of it goes like the days so far: the $5 fee plus any use beyond what the plan includes.' },
    { label: 'Use beyond the plan', meaning: 'The $5 plan includes 10 million worker requests, 30 million CPU milliseconds, 1 million Durable Object requests and 400,000 GB-seconds of Durable Object time each month. Only use past those is charged.' },
    { label: 'Percentages', meaning: "How much of each included amount the month is projected to use." },
  ])}${costNote}`;
}

const costNote = `<p class="note">Worked out from Cloudflare's published prices, not read from the invoice. Days are UTC. Other currencies use the European Central Bank's daily rates.</p>`;

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

export async function render(env: Env, email: string, period: Period, now: Date, fetchImpl: typeof fetch = fetch, plan: Plan = 'paid'): Promise<Response> {
  const nav = `<nav>${PERIODS.map((p) => `<a href="?p=${p.id}&plan=${plan}"${p.id === period ? ' aria-current="page"' : ''}>${p.label}</a>`).join('')}</nav>`;
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
  const kept = (await relayDays(env)).filter((d) => d.day >= range.start && d.day <= range.end);
  const blocks = glance(sumTotals(kept.map((d) => d.totals)));
  const since = kept.length > 0 ? '' : '<p class="note">The relay started keeping these counts on 20 Nov 2026, so earlier days have none.</p>';
  return page(
    'Workspace ops',
    `${head}<h2>Relay</h2><div class="blocks">${blocks.map((b: Block) => blockHtml(b)).join('')}</div>${meanings(blocks)}${since}
${costSection(inMonth, today, plan, period, now)}
<h2>The numbers behind it</h2>${tiles(fns, monthCost)}<h2>By service</h2>${serviceCards(fns)}${byDay(inPeriod)}`,
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
    const plan: Plan = url.searchParams.get('plan') === 'free' ? 'free' : 'paid';
    return render(env, verdict.email, period, new Date(), fetch, plan);
  },
};
