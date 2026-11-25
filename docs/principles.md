# Principles

What every part of Workspace holds to. These are maintainer decisions,
recorded 25 Nov 2026, and a design that breaks one is wrong, however
convenient.

## Open, always

The formats, this spec, and every service a workspace's structure
depends on (relays, Lighthouses, the clients) are open, and always will
be. There's no case where one of them is closed.

Only secrets are private: keys, credentials, and the keys an operator
holds for a service it runs. The code that runs a service is open,
admin included. An operator keeps its keys, not its code.

Closing code no longer buys anything anyway: agents now read and
reverse-engineer software for days without stopping.

## Data is sovereign

A person's, team's or organisation's data belongs to them, wherever they
are and whoever they are. It never depends on one company, one service
or one jurisdiction staying friendly. A workspace keeps working, and
stays readable, if every service Workspace runs disappears.

## Formats outlive their tools

- **People can read them,** at least to an extent, with ordinary tools:
  Markdown is text, JSON Canvas and `.table` are JSON, actions are EDN.
- **Agents can always read them,** without anything from Workspace.
- **Nothing is bound to a service or a database.** What's on disk is the
  whole of it.
- **Leaving is always possible,** at any time, with nothing lost: what
  Workspace adds (actions, kept values, history) sits where other readers
  skip it, and its results are ordinary content.

## Nothing is only in the service

Workspace may run a service for convenience, such as an always-on
Lighthouse. It never does anything that a node someone runs themselves
can't. Whoever runs a node sets its limits and takes their own risk;
no service Workspace operates decides that for them.

## Most people never see any of this

For nearly everyone, Workspace is an app that syncs between their
devices and with the people they share with. The principles are why
it can be trusted with that. Nobody should have to understand them to
use it.

Up: [All docs](./README.md)
