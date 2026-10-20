# Principles

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
   peers do; see [Prior art](./prior-art.md)).
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

Up: [Lighthouse](./README.md) · [All docs](../README.md)
