// Runs the relay as a plain process: `node src/cli.ts`, or the
// `workspace-relay` bin. Settings come from the environment:
//   PORT (default 8787), HOST (default 127.0.0.1; use 0.0.0.0 behind a proxy),
//   RELAY_WAIT_MS, RELAY_MAX_FRAME_BYTES, RELAY_MAX_MEETING_BYTES, RELAY_MAX_MEETING_MS.

import { limitsFrom } from './core.ts';
import { startRelayServer } from './node.ts';

const relay = await startRelayServer({
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1',
  limits: limitsFrom(process.env),
});
console.log(`workspace relay listening on ${relay.url}`);

const stop = () => void relay.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
