# Relay fallback: research notes

Draft, 9 Nov 2026. An exploration, not a decision.

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

## 3. What the Holepunch stack provides

Checked against HyperDHT 6.33.2, Hyperswarm 4.17.0 and blind-relay 1.6.1.

- Relaying is opt-in through `relayThrough`. Hyperswarm forces a relay after `HOLEPUNCH_ABORTED`, `HOLEPUNCH_DOUBLE_RANDOMIZED_NATS` or `REMOTE_NOT_HOLEPUNCHABLE`.
- A relayed connection keeps trying to hole-punch in the background and moves to the direct path if one succeeds. Reconnects try direct first.
- Pear's sidecar sets `relayThrough` only when forced or when its own node is randomized, and ships with no relay key unless one is given.
- The Pear docs say a relay must be a third machine both peers