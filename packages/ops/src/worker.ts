// The maintenance page's one dynamic part: what Workspace's Cloudflare services
// carried and cost, as JSON, for the one person allowed in by Cloudflare
// Access. The page itself is a static asset, served without running this
// worker; switching its views draws from one answer here.

import { verifyAccess } from './access.ts';
import { fetchUsage, type DayUsage } from './usage.ts';
import type { DayTotals } from './story.ts';
import { esc, rangeFor, type Data } from './view.ts';

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

/** How long the reader's browser reuses an answer before asking again. */
export const REUSE_SECONDS = 300;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': status === 200 ? `private, max-age=${REUSE_SECONDS}` : 'no-store' },
  });

/** Everything the page shows, for every period and plan: the month so far and the last seven days. */
export async function usage(env: Env, email: string, now: Date, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
    return json(
      { email, error: 'This page has no Cloudflare API token to read analytics with yet. Add a token with <b>Account Analytics: Read</b> as the secret <code>CF_API_TOKEN</code> on the <code>operations</code> worker.' },
      503,
    );
  }
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
    return json({ email, error: esc(String(error instanceof Error ? error.message : error)) }, 502);
  }
  const relay = (await relayDays(env)).filter((d) => d.day >= start);
  const data: Data = { email, now: now.toISOString(), days, relay };
  return json(data);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/api/usage') return new Response('Not Found', { status: 404 });
    const verdict = await verifyAccess(request.headers.get('cf-access-jwt-assertion'), {
      teamDomain: env.ACCESS_TEAM_DOMAIN,
      aud: env.ACCESS_AUD,
      allowedEmail: env.ALLOWED_EMAIL,
    });
    if (!verdict.ok) return json({ error: 'Forbidden' }, 403);
    return usage(env, verdict.email, new Date());
  },
};
