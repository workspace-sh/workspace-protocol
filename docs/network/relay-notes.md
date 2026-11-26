# Relay fallback: research notes

Draft, 9 Nov 2026; decisions added 15 Nov 2026 (section 2).

## 1. Problem

Two devices sometimes cannot connect, and joins wait.

1. Both devices sit behind randomizing NATs (carrier NAT, some corporate networks). HyperDHT reports `HOLEPUNCH_DOUBLE_RANDOMIZED_NATS`.
2. A laptop is tethered to the phone it syncs with. The cause is unverified: either the carrier gives tethered traffic its own public address, so the same-network shortcut never runs, or the phone's interface list omits the hotspot interface.
3. Some networks do not pass UDP. HyperDHT, its connections and Holepunch's blind relay all use UDP.

## 2. Decisions so far

- Support both serverless and VPS hosting for a Lighthouse. Cloudflare is the preferred serverless host.
- Use Holepunch's published options and modules without forking them.
- A relay is a third machine both devices can reach, so the tethered case is covered whatever its cause.
- Capped public relays come later, if funded.

### Decided, 15 Nov 2026

Seen that day: a phone on a mobile network could not reach a desktop behind a home router at all, so an invite could not be claimed until both were on the same network. A laptop tethered to that phone could not reach the desktop either, so it could not stand in.

- **The relay is a library of its own,** used as soon as it exists. A Lighthouse includes it when Lighthouses are built; the relay does not wait for them.
- **It is code, not a provider.** A small core pairs two connections that ask for the same meeting key and passes bytes between them. Thin adapters run it on serverless hosts (Cloudflare Workers with Durable Objects first) and as a plain process on any machine. One test suite every adapter passes.
- **Workspace's own relays run serverless.** They exist to get people connected, and serverless keeps them cheap, or free at first.
- **Self-hosting: we suggest a VPS** (or any always-on machine), which can also run Holepunch's blind relay over UDP.
- **Blind, optional, replaceable.** Devices encrypt end to end inside the relayed stream, a relay holds nothing and has no authority, and a device takes a list of relays, so anyone can point at their own.
- **Testing** uses an existing Cloudflare account on the free plan. That plan allows only SQLite-backed Durable Objects (`new_sqlite_classes` in the migration).

Next: confirm the pair pipe against `relayThrough` (section 3), then the core, a plain-process adapter and the Cloudflare adapter, then a phone on a mobile network syncing with a desktop behind a home router.

## 3. What the Holepunch stack provides

Checked against HyperDHT 6.33.2, Hyperswarm 4.17.0 and blind-relay 1.6.1.

- Relaying is opt-in through `relayThrough`. Hyperswarm forces a relay after `HOLEPUNCH_ABORTED`, `HOLEPUNCH_DOUBLE_RANDOMIZED_NATS` or `REMOTE_NOT_HOLEPUNCHABLE`.
- A relayed connection keeps trying to hole-punch in the background and moves to the direct path if one succeeds. Reconnects try direct first.
- Pear's sidecar sets `relayThrough` only when forced or when its own node is randomized, and ships with no relay key unless one is given.
- The Pear docs say a relay must be a third machine both peers can reach. Holepunch estimates about 95% of connections are direct and 5% relayed.

## 4. Findings

- No serverless platform offers inbound UDP, so the stock blind relay is VPS/Fly only.
- Serverless path: our own WebSocket pair pipe. Cloudflare Durable Objects with hibernation cost about $5/month at 100k sessions. Fly works (wakes on HTTP/TCP). Azure Web PubSub works but has a per-unit daily fee. AWS API Gateway and Cloud Run are poor fits. DigitalOcean is VPS only.
- @hyperswarm/dht-relay was archived Nov 2025 with no successor. Open community PRs (2026) fix it for Hyperswarm >= 4.11. Proposed: ask Holepunch to unarchive or hand it over, otherwise a shared copy with Ghostly's author; add a "pair mode" alongside its DHT mode.
- Not forking: relayThrough plus NoiseSecretStream over any duplex plus corestore.replicate. bare-ws exists for Bare.


## 5. Other apps on Hypercore

| App | What it does | Stack it uses |
|---|---|---|
| Keet | Chat and video calls, by Holepunch/Tether | Pear, Bare, Hypercore, Autobase, Hyperswarm, blind peers and relays |
| PearPass | Password manager that syncs between devices | Pear, Hypercore, Hyperswarm |
| QVAC | Local AI apps (health assistant, workbench) | Pear, Bare, Hyperswarm |
| CoMapeo | Offline mapping and monitoring for land defenders, by Awana Digital | Hypercore 10, Corestore, Hyperdrive, Hyperswarm, Noise secret stream; finds peers on the local network itself and can also sync to a server over WebSocket |
| Ghostly | Encrypted messenger with a wallet | HyperDHT, plus its own self-hosted HyperDHT relay for its web app |
| Varanda | Brazilian social network | Hyperswarm, HyperDHT relay for its web client |
| Holesail | Shares a local TCP or UDP port with another machine, no port forwarding | HyperDHT |
| datrs | Hypercore and its protocol reimplemented in Rust | Its own implementation |

How each one connects, with links: [relay-apps.md](./relay-apps.md).
