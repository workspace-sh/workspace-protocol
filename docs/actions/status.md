# Where it stands

What the stack has today, what's open, and the first step.

## What the stack has today

From reading the code, 17 Oct 2026:

- **Sandbox:** none. iOS's Bare runs V8 without a JIT, so an interpreter
  is needed: wasmi in Rust beside the markdown core, or QuickJS
  (Holepunch's `libqjs`). `bare-vm` isolates globals but doesn't limit
  CPU or memory.
- **Capabilities:** `ucan-boundary` checks one command and one resource
  policy; there are no invocations. "This action, with this connection,
  on this document" needs both.
- **Results:** single-writer ed25519 attestation only. Multi-writer
  ([`multi-writer.md`](../sync/multi-writer.md)) is unbuilt, and the log has
  no request entry.
- **Headless:** a Node JSON-RPC child exists; no daemon, CLI or service
  identity.
- **Seeding:** content is sealed at the app layer and the membership gate
  admits any `workspace/*` UCAN, so blind seeding needs a
  `workspace/seed` capability.

Blockers, in short: a sandbox, multi-writer, invocations, the always-on
node, delegated secrets, and the web runtime.

## Decided

Decided 12 Nov 2026:

- **Runtime:** the Rust EDN engine already in every app (table-file-format
  `edn/`) becomes the action runtime. Not QuickJS or wasmi. (Its step and
  heap budgets were replaced on 25 Nov by the runner's timeout.)
- **Effects:** an action only asks. The app performs every fetch and every
  write, so the sandbox has no network or file access of its own.
- **Syntax:** stored as EDN; shown as EDN and a formula-like surface first,
  a TypeScript-like one later.
- **Run records:** an action that belongs to a document keeps its value as
  an ordinary, undoable edit in that document's history; a workspace's own
  actions record their runs in the workspace's log.

Decided 25 Nov 2026:

- **What an action is:** a small serverless function, like AWS Lambda or a
  Cloudflare Worker, run locally: on a desktop, a phone or a
  Lighthouse. A Lighthouse has no further powers.
- **Timeouts:** each runner sets its own; the spec sets no maximum
  ([Running](./running.md)).
- **One run per window** across a workspace's devices, Lighthouses
  included ([Running](./running.md#one-run-per-window)).
- **Clock triggers:** `:at` in RFC 9557, and `:cron` as cron's fields by
  name, with seconds, milliseconds and a named zone
  ([Reference](./reference.md#triggers)).
- **Placement** in Markdown, TextBundle, TextPack, JSON Canvas and
  `.table`, and none in plain text ([In files](./in-files.md)).
- **One vocabulary** across every format ([Reference](./reference.md)).

Decided 26 Nov 2026:

- **Where the engine lives:** in this repository, as the
  [`workspace-actions`](../../crates/actions/) crate. It builds on
  table-file-format's EDN reader and printer, and the dependency runs one
  way only: `.table` stays complete without actions, for everyone who
  uses only the table format.
- **One native library in Workspace's apps:** the table core and the
  actions engine are built together, so the shared core is in an app once.

## Open

- Whether actions on a clock belong only to a workspace, or to documents
  too (a document's would run only while it's open somewhere).
- `.table`'s button and view actions.
- `env/write`, and a trigger on new data from a source.
- How a workspace's own actions are stored, and who may add one.
- An always-on node's default: seed only, or also run.
- "Broaden the scope to Arabic": raised, not yet understood.

## First step

Done:

- [Three worked examples](./examples.md).
- The evaluator, [`crates/actions`](../../crates/actions/). It runs examples 1
  and 3 as tests, with each request answered by the test. It also reads
  `:at` and `:cron` and decides when a run is due, one per window.

- The engine does everything that isn't a platform's own job, behind one
  call (an operation's name and JSON in, JSON out):
  - reading and writing Markdown, JSON Canvas and `.table` placement;
  - deciding what an event runs, what its window holds back, and what
    waits for a grant;
  - building each request and reading its answer;
  - writing and checking a run's record.
- Bindings of that one call: Node (the Linux app, the command line) and
  C, with a Swift wrapper. The Linux app keeps a Markdown document's and
  a canvas's kept values fresh while it is on screen: as it opens, when
  a clock comes due, and when a file an action names changes. It reads
  files and `.table`s for `env/read`. In a Markdown document it marks
  each kept value (underlined, with when it was kept and by what), and a
  click on one whose action runs on a tap runs it. A value that
  couldn't be refreshed is shown as it was, marked stale.
- Fetching is the engine's own too ([Fetching](./http.md)): one HTTP
  client and one set of rules on every platform, with reading and
  sending granted apart.
- An app performs the rest (files, the clock, its locale, the screen)
  and remembers what a device has granted. Nothing else.

Next:

- The Swift wrapper built and run on iOS and macOS.
- One native library holding this and the `.table` core, so an app has
  the shared EDN reader once.
- `:tap` on a canvas node, `[:edit …]`, and `.table` documents
  refreshed as Markdown and Canvas are.
- The mark on iOS and macOS.
- Where a run's full record is kept: the document holds the short form
  (the marker), and the workspace's log is to design.

Up: [Workspace actions](./README.md) · [All docs](../README.md)
