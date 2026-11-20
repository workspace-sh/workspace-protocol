import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAccess, type AccessConfig } from '../src/access.ts';

const cfg: AccessConfig = { teamDomain: 'https://team.cloudflareaccess.com', aud: 'aud-1', allowedEmail: 'leslie@workspace.sh' };
const b64url = (b: Uint8Array | string) => Buffer.from(b).toString('base64url');

async function keys() {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as { n: string; e: string; kty: string };
  return { pair, fetchKeys: async () => ({ keys: [{ kid: 'k1', kty: jwk.kty, n: jwk.n, e: jwk.e }] }) };
}

async function sign(pair: CryptoKeyPair, payload: Record<string, unknown>, kid = 'k1') {
  const h = b64url(JSON.stringify({ alg: 'RS256', kid }));
  const p = b64url(JSON.stringify(payload));
  const s = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64url(s)}`;
}

const now = 1_800_000_000_000;
const good = { aud: ['aud-1'], iss: 'https://team.cloudflareaccess.com', email: 'Leslie@workspace.sh', exp: now / 1000 + 600 };

test('lets in the allowed address with a valid token', async () => {
  const { pair, fetchKeys } = await keys();
  assert.deepEqual(await verifyAccess(await sign(pair, good), cfg, { now, fetchKeys }), { ok: true, email: 'Leslie@workspace.sh' });
});

test('refuses anyone else, another application, another issuer, an old token, or none', async () => {
  const { pair, fetchKeys } = await keys();
  const no = async (payload: Record<string, unknown>) => (await verifyAccess(await sign(pair, payload), cfg, { now, fetchKeys })).ok;
  assert.equal(await no({ ...good, email: 'someone@example.com' }), false);
  assert.equal(await no({ ...good, aud: ['aud-2'] }), false);
  assert.equal(await no({ ...good, iss: 'https://other.cloudflareaccess.com' }), false);
  assert.equal(await no({ ...good, exp: now / 1000 - 1 }), false);
  assert.equal((await verifyAccess(null, cfg, { now, fetchKeys })).ok, false);
  assert.equal((await verifyAccess(await sign(pair, good), { ...cfg, aud: '' }, { now, fetchKeys })).ok, false);
});

test('refuses a token changed after signing, or signed by another key', async () => {
  const { pair, fetchKeys } = await keys();
  const token = await sign(pair, good);
  const [h, , s] = token.split('.');
  const forged = `${h}.${b64url(JSON.stringify({ ...good, email: 'leslie@workspace.sh', exp: good.exp + 1 }))}.${s}`;
  assert.equal((await verifyAccess(forged, cfg, { now, fetchKeys })).ok, false);
  const other = await keys();
  assert.equal((await verifyAccess(await sign(other.pair, good), cfg, { now, fetchKeys })).ok, false);
  assert.equal((await verifyAccess(await sign(pair, good, 'k2'), cfg, { now, fetchKeys })).ok, false);
});
