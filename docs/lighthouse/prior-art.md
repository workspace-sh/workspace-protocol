# Prior art: Keet's blind peers and relays

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

Up: [Lighthouse](./README.md) · [All docs](../README.md)
