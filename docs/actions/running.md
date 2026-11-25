# Running

Where an action runs, for how long, and how often across a workspace's
devices. Decided 25 Nov 2026.

## A serverless function, run locally

An action is a small serverless function, in the sense of AWS Lambda or
a Cloudflare Worker, except that it runs where the workspace is: on a
desktop, on a phone, or on a [Lighthouse](../lighthouse/README.md). A
Lighthouse runs actions exactly as a device does, with no further
powers: being always on is the only difference.

## Timeouts belong to whoever runs it

Each run has a timeout, and a run past it is ended and fails as
`:timeout`, keeping the last kept value. That is what stops an action
that never finishes. Whether a program ends can't be known in advance,
so a stop is the only guard there is.

The spec sets no maximum. Each runner chooses its own: a phone or a
desktop picks a default that keeps it responsive, and a self-hosted
Lighthouse, or a host someone pays for, may allow far longer runs. That
choice, and its risk, belongs to the person, team or organisation that
runs the node, never to Workspace or a service Workspace operates.

## One run per window

A workspace's devices don't each run the same action for the same
moment. Before it runs an action, a device reads the latest run record
for it (the `kept` marker for an action in a document, the run record
in the workspace's log for a workspace's action), and doesn't run it
when a run already landed within its window:

| Trigger | The window |
| --- | --- |
| `:fresh` given | That long since the last run |
| `[:at …]` | That moment: once it has run, never again |
| `[:cron …]` | The slot: the run for 09:00 covers 09:00 until the next slot |
| `[:cron … :tz :local]` | The slot, for each member |
| `:open`, `:tap`, `[:edit …]`, `[:change …]` | No window: each one is its own run, on the device where it happened |

This holds for every runner, Lighthouses included.

Two devices can still start the same run before either sees the
other's record. Both results are ordinary edits. The one later in the
log's order stands, and the other is history. At most once per window is
the aim, not a promise, without a node that's always on.

## When a run happens

| Who's online | What's promised |
| --- | --- |
| Only members' devices | **Just in time:** a scheduled run happens when a device is online and the workspace is open. The app says when it can't confirm the timing |
| A Lighthouse, self-hosted or from any provider | On time, within that node's own limits, to the millisecond if it allows |

The app never blocks a schedule it can't guarantee. It says what will
happen.

Up: [Workspace actions](./README.md) · [All docs](../README.md)
