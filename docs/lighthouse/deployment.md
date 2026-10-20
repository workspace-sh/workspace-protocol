# Deployment shapes

Who runs a Lighthouse, and where.

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
  [`discovery-layers.md`](../network/discovery-layers.md)). A Lighthouse may
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

Up: [Lighthouse](./README.md) · [All docs](../README.md)
