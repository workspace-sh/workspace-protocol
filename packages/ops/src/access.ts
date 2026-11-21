// Who is asking: the identity Cloudflare Access vouches for.
//
// Access stands in front of the page and sends every request it lets through
// with a signed token (the Cf-Access-Jwt-Assertion header). The page checks
// that token itself, so it is closed even if Access were switched off or the
// worker reached another way: the signature against the team's published keys,
// the audience of this one application, that it has not expired, and that the
// address in it is the one allowed.

export interface AccessConfig {
  /** e.g. https://workspace-sh.cloudflareaccess.com */
  teamDomain: string;
  /** The Access application's audience tag. */
  aud: string;
  /** The one address let in, compared case-insensitively. */
  allowedEmail: string;
}

export type Verdict = { ok: true; email: string } | { ok: false; reason: string };

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

function b64urlBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson(s: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlBytes(s))) as Record<string, unknown>;
}

/** Fetches the team's signing keys. Injected in tests. */
export type KeyFetch = (url: string) => Promise<{ keys: Jwk[] }>;

const defaultKeyFetch: KeyFetch = async (url) => {
  const r = await fetch(url, { cf: { cacheTtl: 300 } } as RequestInit);
  if (!r.ok) throw new Error(`certs ${r.status}`);
  return (await r.json()) as { keys: Jwk[] };
};

export async function verifyAccess(
  token: string | null,
  cfg: AccessConfig,
  opts: { now?: number; fetchKeys?: KeyFetch } = {},
): Promise<Verdict> {
  if (!cfg.aud) return { ok: false, reason: 'the Access application is not set up yet' };
  if (!token) return { ok: false, reason: 'no Access token' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed token' };
  const [h, p, s] = parts as [string, string, string];
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = b64urlJson(h);
    payload = b64urlJson(p);
  } catch {
    return { ok: false, reason: 'malformed token' };
  }
  if (header.alg !== 'RS256') return { ok: false, reason: 'unexpected algorithm' };
  const { keys } = await (opts.fetchKeys ?? defaultKeyFetch)(`${cfg.teamDomain.replace(/\/+$/, '')}/cdn-cgi/access/certs`);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: 'unknown signing key' };
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signed = new TextEncoder().encode(`${h}.${p}`);
  const good = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(s), signed);
  if (!good) return { ok: false, reason: 'bad signature' };
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) return { ok: false, reason: 'expired' };
  if (typeof payload.nbf === 'number' && payload.nbf > now + 60) return { ok: false, reason: 'not yet valid' };
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(cfg.aud)) return { ok: false, reason: 'wrong application' };
  const iss = typeof payload.iss === 'string' ? payload.iss.replace(/\/+$/, '') : '';
  if (iss !== cfg.teamDomain.replace(/\/+$/, '')) return { ok: false, reason: 'wrong issuer' };
  const email = typeof payload.email === 'string' ? payload.email : '';
  if (email.toLowerCase() !== cfg.allowedEmail.toLowerCase()) return { ok: false, reason: 'not allowed' };
  return { ok: true, email };
}
