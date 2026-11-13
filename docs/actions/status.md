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
  `edn/`) becomes the action runtime, with step counting and a heap cap.
  Not QuickJS or wasmi.
- **Effects:** an action only asks. The app performs every fetch and every
  write, so the sandbox has no network or file access of its own.
- **Syntax:** stored as EDN; shown as EDN and a formula-like surface first,
  a TypeScript-like one later.
- **Run records:** an action that belongs to a document keeps its value as
  an ordinary, undoable edit in that document's history; a workspace's own
  actions record their runs in the workspace's log.

## Open

- Placement in `.table` (`x-actions` in `schema.json`, kept values as
  ordinary cells), to check against the `.table` spec.
- Placement in Markdown (`<!--action … -->`, kept values between
  `<!--[kept …]-->` and `<!--[/kept]-->`).
- Placement in JSON Canvas (`x-action` on nodes and edges), to check
  against what Obsidian keeps.
- How a workspace's own actions are stored, and who may add one.
- An always-on node's default: seed only, or also run.
- "Broaden the scope to Arabic": raised, not yet understood.

## First step

Done: [three worked examples](./examples.md). Next, a minimal
`workspace-action-v1` evaluator in the EDN engine, with a step budget, that
runs examples 1 and 3 with their fetches answered by the test.

Up: [Workspace actions](./README.md) · [All docs](../README.md)
