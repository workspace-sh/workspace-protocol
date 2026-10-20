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

## Open

- The surface syntax or syntaxes.
- Placement in each file type.
- The sandbox, and where it lives.
- Whether run records go in the log of the document or of the workspace.
- How a workspace's own actions are stored, and who may add one.
- An always-on node's default: seed only, or also run.
- "Broaden the scope to Arabic": raised, not yet understood.

## First step

Format only, no runtime. Write three actions as EDN with one surface
syntax, show each converting both ways, and show how each reads when
offline:

1. markdown: a place's coordinates (Nominatim);
2. `.table`: an Open Library cover for each book;
3. canvas: an edge carrying a value from one node to another.

Read-only public sources to try them on: Open-Meteo, Nominatim (one
request a second, and identify the app), Open Library, Wikipedia and
Wikidata, Frankfurter, REST Countries, Nager.Date, USGS earthquakes,
OpenAlex, Crossref, arXiv, MusicBrainz, Open Food Facts, GitHub REST,
Hacker News.

Up: [Workspace actions](./README.md) · [All docs](../README.md)
