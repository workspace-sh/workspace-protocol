// Runs the shared suite against the Cloudflare adapter in wrangler's local
// runtime (workerd). No Cloudflare account is needed.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { TEST_LIMITS, relaySuite } from './suite.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

relaySuite('Cloudflare (local)', async () => {
  const port = await freePort();
  const vars = {
    RELAY_WAIT_MS: TEST_LIMITS.waitMs,
    RELAY_MAX_FRAME_BYTES: TEST_LIMITS.maxFrameBytes,
    RELAY_MAX_MEETING_BYTES: TEST_LIMITS.maxMeetingBytes,
    RELAY_MAX_MEETING_MS: TEST_LIMITS.maxMeetingMs,
    RELAY_SILENCE_MS: TEST_LIMITS.silenceMs,
  };
  const args = ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(port), '--show-interactive-dev-session=false'];
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
  const child = spawn('npx', args, {
    cwd: root,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {
      // not up yet
    }
    if (child.exitCode !== null || Date.now() > deadline) throw new Error(`wrangler dev did not start:\n${log}`);
    await new Promise((r) => setTimeout(r, 300));
  }

  return {
    url: `ws://127.0.0.1:${port}`,
    close: async () => {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    },
  };
});
