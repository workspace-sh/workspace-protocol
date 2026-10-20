# Lighthouse

A Lighthouse is a trusted always-on node a user opts a workspace into.
It stays online, replicates the workspace's logs, and keeps the swarm
reachable when no peer device is awake.

Lighthouses are optional. A workspace works without one — that's the
whole point of the P2P design. But laptops close, phones sleep, and
offices have weekends. A Lighthouse is how an organisation gets
reliability without leaving a machine plugged in under someone's desk.

**Status:** concept — design and implementation pending, post-spike.
The Lighthouse implementation will live in a separate repo (TBD).

---

## Principles

Agreed with Leslie, 20 Oct 2026. These bound the design below; how they
are built is still open.

1. **Just another peer.** A Lighthouse has no powers a member's device
   doesn't have. It joins a workspace as any member does: invited, with
   UCANs, revocable. How a paid one is handed over or set up comes later.
2. **Self-hosting first.** The packages make running a Lighthouse so easy
   that nobody needs ours. A paid Lighthouse sells convenience and
   availability, never authority, and moving to a self-hosted one costs
   nothing but the move. (Strapi's model: open and easy to host, with a
   hosted option for those who'd rather pay.)
3. **Blind**, in Holepunch's sense: it holds a workspace's encrypted data
   and keeps it available without the keys to read it (as Keet's blind
   peers do; see [Prior art](#prior-art-keets-blind-peers-and-relays)).
4. **One network, shared.** Lighthouses join the public HyperDHT and help
   carry it, alongside Keet and every other Hyperswarm app, so Workspace
   is never an island. Hole punching first; a blind relay where a network
   won't allow it. A private network (own bootstrap nodes) is an option
   for a paid tier or an organisation, chosen per workspace, on the same
   protocol.
5. **Guardrails in the service and the workspace, never the routing.**
   Who we sell a hosted Lighthouse to is screened as any business must
   (sanctions included); who may join a workspace is its owner's call,
   through UCANs. Neither stops anyone's packets reaching the network.
6. **Price by storage, not history.** A flat fee for a storage allowance
   (say 20 GB or 50 GB) under a fair-use policy, with more available when
   it's reached. History is never what's charged for.
7. **Retention is the workspace's choice, including forever.** An archive
   (the Ukraine war archive, say) may keep every version indefinitely.
   The cost of history is kept down by compacting it, not by limiting it:
   full history for recent months, then progressively sparser past them
   (for example 1, 3, 6, 9 and 12 months, then at growing intervals),
   with what's older archived to cheaper storage. Old history is rarely
   read, so it doesn't need to be shared across peers or fetched quickly;
   it only has to be kept.
8. **A Lighthouse holds everything; devices hold what they can.** A
   Lighthouse is a full replica of a workspace: its whole tree and its
   history. A member's device replicates sparsely, as much as it has room
   and network for: a phone a little, a desktop 5 to 50 GB. Media is what
   fills space first. What doesn't fit on a Lighthouse's allowance may
   also be held by other mostly-online peers, rather than forced onto it.

## Prior art: Keet's blind peers and relays

Keet, on the same Holepunch stack, is serverless and still works with
people offline, on phones, and across strict networks:

- **Blind peers** stay online and hold a room's encrypted data, so a
  message waits for someone who's offline. They can't read it.
- **Blind relays** forward encrypted traffic between two peers that can't
  reach each other directly. They store nothing.

A client can use blind peers "you run yourself… or shared ones". Whether
Holepunch offers shared ones to other apps isn't documented. Blind
peering needs a capability Workspace doesn't have yet: membership admits
any `workspace/*` UCAN, so a peer that may seed but not read needs one of
its own (`workspace/seed`).

- [Keet: Blind Peering](https://keet-support-docs-qptz7-commit-c21a8f3.kinsta.page/security-and-privacy/blind-peering/)
- [Pear: Add blind peering to a chat app](https://docs.pears.com/how-to/blind-peering/add-blind-peering-to-a-chat-app/)
- [Pear: Relay connections through a blind relay](https://pear-docs-published-i1yp5-commit-a510a9a.kinsta.page/how-to/connect-to-peers/relay-connections-through-a-blind-relay/)

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
- **Not a relay.** Relays forward topic traffic without holding state.
  Lighthouses hold state — they're full peers. Both can coexist; they
  solve different problems.
- **Not an Anchor.** "Anchor" is reserved separately for a future
  on-chain bootstrap concept (immutable discovery metadata in
  perpetuity). Lighthouses are mutable, opt-in, operational. Anchors
  would be permanent, fixed, foundational.

---

## Deployment shapes

The same code runs in all three:

- **Self-hosted.** A user runs the Lighthouse binary on a VPS, a home
  server, an old laptop in a cupboard. They control it end-to-end.
- **Org-hosted.** An organisation runs Lighthouses for their team's
  workspaces. Same binary, more uptime, possibly hardened.
- **Hosted service (free or paid).** A provider runs Lighthouses for
  users who don't want to deal with infrastructure. Same binary, run
  by us. Free tier for casual workspaces, paid tier for storage and
  bandwidth beyond a threshold.

A workspace can be pointed at multiple Lighthouses. None of them is
authoritative; they're all just peers with good uptime.

### When a Lighthouse is needed — and when it isn't

Lighthouses are an **availability** tool, not a discovery
requirement. Whether one is needed depends on where workspace members
actually are:

- **Same-LAN orgs** (everyone in one office, household, or other
  shared network) don't need a Lighthouse for the LAN to work. Peers
  discover each other directly via the LAN-discovery layer (see
  [`discovery-layers.md`](./discovery-layers.md)). A Lighthouse may
  still be useful for "the laptops are all asleep at the weekend" —
  but it's an opt-in convenience, not a prerequisite.
- **Remote-team orgs** (members spread across the internet) get
  significant value from a Lighthouse. With one running on a host
  that's reachable over WAN — a VPS, a hosted service — peers have a
  reliable rendezvous point without depending on the public DHT or on
  any given member's device being online.

The architecture stays the same in both cases; the Lighthouse is just
absent in the first and present in the second.

---

## Cross-references

- [`workspace-format.md`](./workspace-format.md) — the format a
  Lighthouse replicates
- [`permissions-model.md`](./permissions-model.md) — the capability
  layer a Lighthouse participates in (no special privileges)
- [`discovery.md`](./discovery.md) — how a workspace's URI gets
  resolved (separate from how its content gets replicated)
- [`discovery-layers.md`](./discovery-layers.md) — the local-first /
  LAN / WAN discovery hierarchy a Lighthouse fits into at layer 3
- [`threat-model.md`](./threat-model.md) — what trusting a Lighthouse
  does and doesn't expose
- [`uri-scheme.md`](./uri-scheme.md) — `workspace://` URIs can name
  a Lighthouse as a cold-start hint via the `relays=` parameter
- [`risks.md`](./risks.md) — Lighthouse mitigates the casual-user
  relay dependency (risk #1) and the mobile-only availability gap
  (risk #2)

---

## Naming

Named by Michelangelo, after a visit to the lighthouse at Tossa del
Mar. A lighthouse doesn't own the harbour or guide the boats — it
just stays lit, so the boats can find their way home. Same job.
