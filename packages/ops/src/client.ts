// The page in the reader's browser: one request to the worker for the numbers,
// then every switch of period or plan is drawn here from what came back.

import { problem, view, type Data, type Period, type Plan } from './view.ts';

const main = document.querySelector('main')!;
const query = new URLSearchParams(location.search);
// It always opens on today: a period chosen lasts while the page is open, and an address saved with one (a home-screen icon) doesn't keep it.
let period: Period = 'today';
let plan: Plan = query.get('plan') === 'free' ? 'free' : 'paid';
let data: Data | undefined;
let failure: string | undefined;

// Amounts in the chosen currency. Rates come from a free public service
// (Frankfurter: European Central Bank rates); the numbers stay US dollars.
let rates: Record<string, number> = { USD: 1 };
let currency = 'USD';
try {
  currency = localStorage.getItem('currency') || 'USD';
} catch {}
let ratesFailed = false;

function showCurrency(): void {
  const pick = document.getElementById('currency') as HTMLSelectElement | null;
  if (pick) {
    pick.value = currency;
    pick.disabled = ratesFailed;
    if (ratesFailed) pick.title = 'Exchange rates are unavailable; amounts are in US dollars.';
  }
  const rate = rates[currency];
  if (!rate) return;
  const f = new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 });
  for (const el of document.querySelectorAll<HTMLElement>('[data-usd]')) {
    const v = Number(el.dataset['usd']) * rate;
    el.textContent = v > 0 && v < 0.01 ? `< ${f.format(0.01)}` : f.format(v);
  }
}

function draw(): void {
  if (failure !== undefined) main.innerHTML = problem(data?.email, period, failure);
  else if (data) main.innerHTML = view(data, period, plan);
  else return;
  showCurrency();
}

main.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('button');
  if (!button) return;
  const p = button.dataset['period'] as Period | undefined;
  const pl = button.dataset['plan'] as Plan | undefined;
  if (p) period = p;
  else if (pl) plan = pl;
  else return;
  history.replaceState(null, '', `?plan=${plan}`);
  draw();
});

main.addEventListener('change', (event) => {
  const pick = event.target as HTMLSelectElement;
  if (pick.id !== 'currency') return;
  currency = pick.value;
  try {
    localStorage.setItem('currency', currency);
  } catch {}
  showCurrency();
});

fetch('https://api.frankfurter.dev/v1/latest?base=USD')
  .then((r) => r.json() as Promise<{ rates: Record<string, number> }>)
  .then((d) => {
    rates = { USD: 1, ...d.rates };
    showCurrency();
  })
  .catch(() => {
    ratesFailed = true;
    showCurrency();
  });

// A sign-in that has run out answers with a redirect to Cloudflare Access.
fetch('/api/usage', { redirect: 'manual', credentials: 'same-origin' })
  .then(async (r) => {
    if (r.type === 'opaqueredirect' || r.status === 401 || r.status === 403) {
      failure = 'Your sign-in has ended. <a href="">Reload</a> to sign in again.';
      return;
    }
    const body = (await r.json()) as Data | { email?: string; error: string };
    if ('error' in body) {
      failure = body.error;
      data = body.email ? ({ email: body.email } as Data) : undefined;
    } else data = body;
  })
  .catch(() => {
    failure = 'The numbers could not be read. <a href="">Reload</a> to try again.';
  })
  .then(draw);
