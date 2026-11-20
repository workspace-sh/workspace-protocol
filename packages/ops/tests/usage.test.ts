import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromRaw, paidCost, freeShare, sumByFunction, totals } from '../src/usage.ts';
import { render, rangeFor } from '../src/worker.ts';

const raw = {
  w: [
    { sum: { requests: 1167, errors: 0, cpuTimeUs: 995_847, responseBodySize: 2_326_752 }, dimensions: { scriptName: 'workspace-relay', date: '2026-11-20' } },
    { sum: { requests: 13, errors: 1, cpuTimeUs: 13_000, responseBodySize: 1000 }, dimensions: { scriptName: 'workspace-relay', date: '2026-11-17' } },
  ],
  di: [{ sum: { requests: 4339, errors: 2, responseBodySize: 4_000 }, dimensions: { scriptName: 'workspace-relay', date: '2026-11-20' } }],
  dp: [
    {
      sum: { activeTime: 2_696_340_575, cpuTime: 1_704_516, inboundWebsocketMsgCount: 400, outboundWebsocketMsgCount: 2017 },
      dimensions: { namespaceId: '7101790763ac42dba67e6b044b55ec35', date: '2026-11-20' },
    },
  ],
};

test('each worker and its objects are one row a day, with duration billed at 128 MB', () => {
  const days = fromRaw(raw);
  assert.deepEqual(days.map((d) => d.date), ['2026-11-17', '2026-11-20']);
  const objects = days[1]!.functions.find((f) => f.kind === 'durable-object')!;
  assert.equal(objects.name, 'workspace-relay');
  assert.equal(objects.requests, 4339);
  assert.equal(Math.round(objects.gbSeconds), Math.round(2696.340575 * 0.125));
  assert.equal(objects.wsOut, 2017);
  const worker = days[1]!.functions.find((f) => f.kind === 'worker')!;
  assert.equal(Math.round(worker.cpuMs), 996);
  assert.equal(sumByFunction(days).find((f) => f.kind === 'worker')!.requests, 1180);
});

test('incoming WebSocket messages count as Durable Object requests at 20 to 1', () => {
  const t = totals(fromRaw(raw)[1]!.functions);
  assert.equal(t.doRequests, 4339 + 400 / 20);
});

test('the paid plan charges only past what it includes', () => {
  const small = paidCost(totals(fromRaw(raw).flatMap((d) => d.functions)));
  assert.equal(small.usage, 0);
  assert.equal(small.withFee, 5);
  const big = paidCost({ workerRequests: 12_000_000, workerCpuMs: 0, doRequests: 3_000_000, doGbSeconds: 500_000, bytesOut: 0, errors: 0 });
  // 2M worker requests at $0.30, 2M object requests at $0.15, 100k GB-s at $12.50 per million.
  assert.equal(big.usage.toFixed(4), (0.6 + 0.3 + 1.25).toFixed(4));
});

test("a day's share of the free allowance", () => {
  const share = freeShare({ workerRequests: 50_000, workerCpuMs: 0, doRequests: 0, doGbSeconds: 13_000, bytesOut: 0, errors: 0 });
  assert.deepEqual(share.map((s) => s.share), [0.5, 0, 1]);
});

test('periods run in UTC days', () => {
  const now = new Date('2026-11-03T10:00:00Z');
  assert.deepEqual(rangeFor('today', now), { start: '2026-11-03', end: '2026-11-03' });
  assert.deepEqual(rangeFor('7d', now), { start: '2026-10-28', end: '2026-11-03' });
  assert.deepEqual(rangeFor('month', now), { start: '2026-11-01', end: '2026-11-03' });
});

test('the page shows each service and the month’s cost, and asks for a token when it has none', async () => {
  const env = { ACCESS_TEAM_DOMAIN: 'x', ACCESS_AUD: 'a', ALLOWED_EMAIL: 'leslie@workspace.sh', CF_API_TOKEN: 't', CF_ACCOUNT_ID: 'acct' };
  let asked: { auth: string | null; vars: Record<string, string> } | null = null;
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    asked = { auth: new Headers(init.headers).get('authorization'), vars: JSON.parse(String(init.body)).variables };
    return Response.json({ data: { viewer: { accounts: [raw] } }, errors: null });
  }) as typeof fetch;
  const html = await (await render(env, 'leslie@workspace.sh', 'month', new Date('2026-11-20T19:00:00Z'), fakeFetch)).text();
  assert.equal(asked!.auth, 'Bearer t');
  assert.deepEqual(asked!.vars, { a: 'acct', s: '2026-11-01', e: '2026-11-20' });
  assert.match(html, /workspace-relay/);
  assert.match(html, /Durable Objects/);
  assert.match(html, /\$5\.00/);
  assert.match(html, /Signed in as leslie@workspace\.sh/);
  const none = await (await render({ ...env, CF_API_TOKEN: undefined }, 'leslie@workspace.sh', 'today', new Date())).text();
  assert.match(none, /no Cloudflare API token/);
});
