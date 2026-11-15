# @workspace.sh/relay

> **Pre-alpha. Do not use this.** It has not been deployed or reviewed, and
> its wire protocol will change without notice. It is published so the work
> is visible, not so anyone can rely on it.

A blind relay for devices that cannot reach each other directly: a phone on
a mobile network and a desktop behind a home router, say. Both devices open
a WebSocket to the relay with the same meeting key. The relay pairs them and
passes bytes between them without reading them.

The same core runs in two places:

| Where | Adapter | Notes |
|---|---|---|
| Cloudflare Workers | `src/cloudflare.ts` | One Durable Object per meeting, with the hibernation API, so a waiting meeting costs nothing. SQLite-backed objects, which the free plan allows. |
| Any machine (VPS, home server) | `src/node.ts`, run with `npm start` | A plain Node process. Put TLS in front of it (Caddy, nginx) for `wss://`. |

One test suite (`tests/suite.ts`) runs against both: the plain process
directly, and the Cloudflare adapter in wrangler's local runtime, which needs
no Cloudflare account.

## Protocol, version 1

1. A device opens `wss://<relay>/v1/pair/<key>`, where `<key>` is 64
   lowercase hex characters (32 bytes) that both devices derived for this
   meeting.
2. A third connection to a meeting that already has two is refused (HTTP 409).
3. When the second device arrives, the relay sends the text frame `paired`
   to both. Devices send nothing before it.
4. After that, every binary frame one device sends reaches the other
   unchanged and in order. Text frames from devices are refused.
5. When either device leaves, the relay closes the other. The key can then
   be used again.

Close codes: 4000 the other device left; 4001 a protocol error (data before
`paired`, or a text frame); 4002 no second device arrived in time; 4003 a
limit was reached.

Limits, set by environment variable (Cloudflare: `[vars]` or `--var`):

| Variable | Default |
|---|---|
| `RELAY_WAIT_MS` | 60000 (one minute) |
| `RELAY_MAX_FRAME_BYTES` | 1 MiB |
| `RELAY_MAX_MEETING_BYTES` | 512 MiB |
| `RELAY_MAX_MEETING_MS` | 2 hours |

Each frame counts as at least 64 bytes against the meeting's limit, so a
flood of empty frames ends a meeting like any other traffic.

The plain process also takes `maxMeetings` (default 10,000; more are refused
with 503) and `maxPerAddress` (16 connections from one address at once; more
are refused with 429), and pauses a sender while the other device's queue is
over 4 MiB. Behind a reverse proxy, `addressHeader` names the header that
carries the client's address; set it only if the proxy overwrites that header.

## What the relay can and cannot see

The relay is meant to be safe to run by anyone, including people a device
does not trust. That holds only if devices do their part:

- **Devices must encrypt end to end inside the relayed stream** (Hyperswarm's
  Noise secret stream) and check the other device's key. The relay passes
  bytes; it does not authenticate anyone.
- **The relay sees metadata:** both devices' IP addresses, when they meet,
  how long for and how many bytes. Its host (Cloudflare, or a VPS provider)
  can see the same.
- **The meeting key is not a secret worth protecting, and should not be
  stable.** Whoever knows it can take a place in the meeting before the real
  device and so block it, though not read it. A key reused across meetings
  lets the relay link them, so devices should derive a fresh key per meeting.
  How devices derive and exchange keys is not settled yet.
- **The relay stores nothing.** The Cloudflare adapter keeps per-connection
  counters in memory and in the socket attachment only.

## Known gaps

- Anyone can open meetings. There is no authentication and no Origin check,
  so a public deployment can be used as a general-purpose pipe. The
  Cloudflare adapter has no per-address cap yet, so strangers can drive its
  cost up; on the free plan that stops the service rather than adding to the
  bill.
- The Cloudflare adapter has no backpressure: a fast sender towards a slow
  device queues in the Durable Object's memory until the object is reset.
- Local workerd delivers a server's close frame at once but closes the TCP
  connection about ten seconds later; whether Cloudflare does the same is
  not yet checked.
- No device uses the relay yet.

## Running

```sh
npm install                 # from the repository root
npm test -w @workspace.sh/relay
npm start -w @workspace.sh/relay           # plain process on 127.0.0.1:8787
npm run dev:cloudflare -w @workspace.sh/relay   # Cloudflare adapter, locally
```
