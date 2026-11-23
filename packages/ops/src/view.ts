// The page's view: everything it shows, built from one answer of the worker's
// (`/api/usage`). It runs in the reader's browser, so switching the period or
// the plan redraws from numbers already fetched and asks the worker nothing.

import { freeShare, paidCost, projectMonth, sumByFunction, totals, type DayUsage, type FunctionUsage } from './usage.ts';
import { glance, sumTotals, type Block, type DayTotals } from './story.ts';

/** What the worker answers: the month so far and the last seven days, in one go. */
export interface Data {
  email: string;
  /** When the worker read the numbers, ISO 8601. */
  now: string;
  days: DayUsage[];
  /** The relay's kept daily totals of how meetings ended. */
  relay: { day: string; totals: DayTotals }[];
}

export type Period = 'today' | '7d' | 'month';

const day = (d: Date) => d.toISOString().slice(0, 10);

/** The first and last day (UTC) of `period`, ending `now`. */
export function rangeFor(period: Period, now: Date): { start: string; end: string } {
  const end = day(now);
  if (period === 'today') return { start: end, end };
  if (period === '7d') return { start: day(new Date(now.getTime() - 6 * 86_400_000)), end };
  return { start: `${end.slice(0, 8)}01`, end };
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
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
  relay: {
    label: 'Relay',
    role: "Pairs two devices that can't reach each other directly and passes their encrypted traffic, unread.",
  },
  operations: { label: 'This dashboard', role: 'This page.' },
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

function costSection(month: DayUsage[], today: DayUsage | undefined, plan: Plan, now: Date): string {
  const sofar = totals(month.flatMap((d) => d.functions));
  const projected = projectMonth(sofar, now);
  const toggle = `<span class="seg">${(['free', 'paid'] as const)
    .map((p) => `<button type="button" data-plan="${p}" aria-pressed="${p === plan}">${p === 'free' ? 'Free plan' : '$5 plan'}</button>`)
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


export const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: 'month', label: 'This month' },
];

export function header(email: string | undefined, period: Period): string {
  const nav = `<nav>${PERIODS.map((p) => `<button type="button" data-period="${p.id}"${p.id === period ? ' aria-pressed="true"' : ' aria-pressed="false"'}>${p.label}</button>`).join('')}</nav>`;
  return `<h1>Workspace on Cloudflare</h1><div class="who">${email ? `Signed in as ${esc(email)}` : '&nbsp;'}</div>${nav}`;
}

/** The whole page for `period` and `plan`, from `data`. */
export function view(data: Data, period: Period, plan: Plan): string {
  const now = new Date(data.now);
  const month = rangeFor('month', now);
  const range = rangeFor(period, now);
  const inPeriod = data.days.filter((d) => d.date >= range.start && d.date <= range.end);
  const inMonth = data.days.filter((d) => d.date >= month.start);
  const today = data.days.find((d) => d.date === month.end);
  const fns = sumByFunction(inPeriod);
  const monthCost = paidCost(totals(inMonth.flatMap((d) => d.functions))).usage;
  const kept = data.relay.filter((d) => d.day >= range.start && d.day <= range.end);
  const blocks = glance(sumTotals(kept.map((d) => d.totals)));
  const since = kept.length > 0 ? '' : '<p class="note">The relay started keeping these counts on 20 Nov 2026, so earlier days have none.</p>';
  return `${header(data.email, period)}<h2>Relay</h2><div class="blocks">${blocks.map((b: Block) => blockHtml(b)).join('')}</div>${meanings(blocks)}${since}
${costSection(inMonth, today, plan, now)}
<h2>The numbers behind it</h2>${tiles(fns, monthCost)}<h2>By service</h2>${serviceCards(fns)}${byDay(inPeriod)}`;
}

export function problem(email: string | undefined, period: Period, message: string): string {
  return `${header(email, period)}<p class="err">${message}</p>`;
}
