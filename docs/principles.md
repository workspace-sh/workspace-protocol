# Principles

The goals this spec shares with everyone building on it: other apps,
self-hosted and third-party services, and tools that read and write
these formats. It isn't Workspace's. Workspace's apps are one way in.
Recorded 25 Nov 2026, as maintainer decisions. A design that breaks one
is wrong, however convenient.

These are commitments, not terms. Each repository's licence is what
grants rights, and nothing here takes any away or adds a condition: no
one, anywhere, for any purpose, needs anything from this page to use,
change or share this work. The principles may change, but only to
protect more, never less.

## Built on what came before

Local-first software, peer-to-peer replication and open file formats
are nearly two decades old: Dat and Hypercore, CRDTs, Markdown, JSON
Canvas. What changed is the world around them. Fast mobile networks
(5G now, more to come) let devices reach each other directly almost
anywhere. Agents have cut the cost of building software, though not the
cost of taste. This spec is an attempt to put those pieces together
carefully, in the open, for anyone to use.

It owes that work its standing, not only its code. The protocol is
licensed as the projects it builds on are (Apache-2.0, beside their
MIT), so anything here can flow back to them without asking. The file
formats are MIT, so any app or company can adopt them without friction.

## Open, always

The formats, this spec, and every service a workspace's structure
depends on (relays, Lighthouses, clients) are open and always will be.
There's no case where one of them is closed. Each repository carries an
open-source licence, and anyone may build on them.

Only secrets are private: keys, credentials, and the keys an operator
holds for a service it runs. The code that runs a service is open,
admin included. An operator keeps its keys, not its code.

Closing code no longer buys anything anyway: agents now read and
reverse-engineer software for days without stopping.

## Forks are welcome

Anyone may take this work and go further with it, under its licences,
with or without contributing back what the licence doesn't require. If
a fork does it better, it deserves to win: that is how open work
improves.

## Data is sovereign

A person's, team's or organisation's data belongs to them, wherever they
are and whoever they are. It never depends on one company, one service
or one jurisdiction staying friendly. A workspace keeps working, and
stays readable, if any service, Workspace's included, disappears.

## Formats outlive their tools

- **People can read them,** at least to an extent, with ordinary tools:
  Markdown is text, JSON Canvas and `.table` are JSON, actions are EDN.
- **Agents can always read them,** without any one vendor's software.
- **Nothing is bound to a service or a database.** What's on disk is the
  whole of it.
- **Leaving is always possible,** at any time, with nothing lost: what's
  added on top (actions, kept values, history) sits where other readers
  skip it, and its results are ordinary content.

## Every language

The formats hold any language people write: every script and direction,
languages with few speakers, languages not yet written down, and
languages coming back into use. Nothing in a format assumes one
alphabet, one direction or one region.

## Services sell convenience, never access

Anyone may run a service on top of this spec: relays, always-on
Lighthouses, hosting. Workspace will run some too. None may do anything
a node someone runs themselves can't. Whoever runs a node sets its
limits and takes their own risk, and no other service decides that for
them.

## Most people never see any of this

For nearly everyone, this is an app that syncs between their devices and
with the people they share with. The principles are why it can be
trusted with that. Nobody should have to understand them to use it.

Up: [All docs](./README.md)
