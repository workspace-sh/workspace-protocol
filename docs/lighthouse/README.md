# Lighthouse

A Lighthouse is a trusted always-on node a user opts a workspace into.
It stays online, replicates the workspace's logs, and keeps the swarm
reachable when no peer device is awake.

Lighthouses are optional. A workspace works without one — that's the
whole point of the P2P design. But laptops close, phones sleep, and
offices have weekends. A Lighthouse keeps a workspace reachable through
all of that.

Anyone can run one: an individual, a group, a team or an organisation,
on a machine of their own or a rented server. A hosted service (an
eventual Workspace offering among them) runs the same spec; it's a
convenience, never a requirement.

**Status:** concept — design and implementation pending, post-spike.
The Lighthouse implementation will live in a separate repo (TBD).

---

## What it is

A Lighthouse is a peer. It joins the swarm like any other peer, holds
the same Hypercore logs, replicates the same blocks. The difference is
operational, not architectural:

- It's online all the time
- It's run by someone the workspace's owner has chosen to trust with
  availability (themselves, their org, or a paid provider)
- It has no special cryptographic authority — it can't forge writes,
  can't grant capabilities, can't read tier-gated content it hasn't
  been granted access to

In capability terms, a Lighthouse holds whatever UCAN delegation the
workspace owner issued it. Usually that's enough to participate in
replication and serve blocks back to peers. It doesn't need write
access to be useful. It doesn't need decryption keys to be useful. It
just needs to be reachable.

---

## Why it matters

Pure P2P is great until everyone goes to sleep at the same time. Three
failure modes a Lighthouse closes:

- **The "everyone's offline" gap.** A small team where every member's
  laptop is asleep means a new joiner can't find anyone to sync from.
  A Lighthouse stays up.
- **The cold-start problem.** First-time peers need *somewhere* to
  fetch the initial blocks. A Lighthouse serves that role without
  being authoritative.
- **The mobile peer problem.** Phones sleep aggressively, throttle
  background work, and can't be relied on as swarm participants.
  Desktops are better but not always-on. A Lighthouse is.

None of this gives up the P2P guarantees. The cryptographic substrate
is unchanged; the Lighthouse is just a peer that happens to be plugged
in.

---

## What it is not

- **Not authoritative.** The workspace's root attestation is the
  ground truth. A Lighthouse can't fork the workspace, can't censor
  writes (peers can still talk directly), can't grant or revoke
  capabilities. Its trust is operational (availability), not
  cryptographic.
- **Not custodial.** A Lighthouse holds bytes, not access. Tier-gated
  content is encrypted at rest; the Lighthouse stores it but can't
  read it unless it was issued the same keys as a regular member.
- **Not only a relay.** A relay forwards encrypted traffic between two
  devices that can't reach each other, and holds nothing. A Lighthouse
  may offer a relay as well, but its main job is holding the workspace.
  The one exception, for now, is a serverless Lighthouse (below).

---

## Two kinds: on a server, or serverless

Exploration, 9 Nov 2026; see [relay notes](../network/relay-notes.md).

| | On a server (VPS, home server) | Serverless (Cloudflare preferred) |
| --- | --- | --- |
| Holds the workspace | Yes, a full peer | Not yet (open) |
| Relays | Holepunch's blind relay over UDP, and a WebSocket relay on port 443 | A WebSocket relay on port 443 only |
| Runs | All the time | Only while two devices are connected through it |
| Costs | A server | Per message; about $5 a month at 100k relayed sessions |

Either kind relays only when hole punching fails (about 5% of
connections), and the relay can't read what it forwards: devices
encrypt end to end and check each other's keys. A relayed connection
keeps trying to punch through, and moves to a direct one when it can.
Both use Holepunch's modules as published, with no forks.

---

## In this folder

- [`principles.md`](./principles.md): what a Lighthouse must and mustn't be (agreed 20 Oct 2026)
- [`deployment.md`](./deployment.md): who runs one, and where
- [`prior-art.md`](./prior-art.md): Keet's blind peers and relays
- [Relay notes](../network/relay-notes.md): the relay research behind the two kinds

## Cross-references

- [`workspace-format.md`](../format/workspace-format.md) — the format a
  Lighthouse replicates
- [`permissions-model.md`](../permissions/permissions-model.md) — the capability
  layer a Lighthouse participates in (no special privileges)
- [`discovery.md`](../network/discovery.md) — how a workspace's URI gets
  resolved (separate from how its content gets replicated)
- [`discovery-layers.md`](../network/discovery-layers.md) — the local-first /
  LAN / WAN discovery hierarchy a Lighthouse fits into at layer 3
- [`threat-model.md`](../security/threat-model.md) — what trusting a Lighthouse
  does and doesn't expose
- [`uri-scheme.md`](../format/uri-scheme.md) — `workspace://` URIs can name
  a Lighthouse as a cold-start hint via the `relays=` parameter
- [`risks.md`](../security/risks.md) — Lighthouse mitigates the casual-user
  relay dependency (risk #1) and the mobile-only availability gap
  (risk #2)

---

## Naming

Named by Michelangelo, after a visit to the lighthouse at Tossa del
Mar. A lighthouse doesn't own the harbour or guide the boats — it
just stays lit, so the boats can find their way home. Same job.

Up: [All docs](../README.md)
