# Workspace actions

Small functions that Workspace content carries, in one document, across
files, or for a whole workspace. They run in a sandbox on a device that
has agreed to run them, and can show a live value or keep one in the
content they belong to.

**Status:** a spike within this spec. Nothing here is decided unless it
says so, and nothing is built. It records the thinking so far on
content carrying functions that work over Workspace's peer-to-peer
loop, what they could be used for, and prior art: naive on purpose, so
the thinking can move. Tracking: workspace-sh/workspace#699.

"Action" (or "function") describes the kind of thing it is; it isn't an
official name.

---

## Why it's here

An action needs the protocol: a device's grant to run it, a
capability (UCAN) for each thing it may do, its runs recorded in the
log of what it belongs to, and, when nobody's device is awake, a
[Lighthouse](../lighthouse/README.md). None of the file formats needs any of
that, so it lives with the protocol, not in a format's spec.

The line between the two:

| | Formula | Action |
| --- | --- | --- |
| Example | `=SUM(values "spend")` | Fetch a place's coordinates |
| Reaches outside the document | Never | Only what it declares and the device grants |
| Who can compute it | Any client, Workspace or not | Workspace, on a device that agreed |
| Same inputs, same answer | Always | Not promised (the outside world changes) |
| Where it's specified | The file format (`.table`'s formulas, table-file-format#626) | Here |

A file format only reserves a place for an action and keeps its results
as ordinary content (see [Where an action lives in a file](./in-files.md)),
so a client that knows nothing of actions loses nothing.

## Where an action belongs

The same kind of function at three sizes. What it may read and write,
who grants it, and where its runs are recorded follow from where it
belongs.

| Belongs to | Example | Reads | Writes | Triggered by |
| --- | --- | --- | --- | --- |
| **One document** | A place's coordinates in a note; a cover for each book in a `.table` | That document | That document | Opening it, a tap, an edit in it |
| **Several files** | A canvas node showing a total from a `.table`; a summary note kept up to date from three others | The files it names, by relative path | The document it lives in; another needs a grant | A change in any file it reads |
| **A workspace** | A workspace's home page listing what changed this week; a daily exchange rate every document can use | Anything in the workspace it's granted | Files it's granted, as ordinary edits | Opening the workspace, a timer, an always-on node |

The larger the scope, the more it needs the protocol: an action across
files needs read grants for each file it names, and a workspace's
actions are where an always-on node ([Lighthouse](../lighthouse/README.md))
matters, because a workspace is open somewhere far more often than one
document is. A workspace-level action is defined in the workspace
itself (beside its policy, see [`workspace-format.md`](../format/workspace-format.md)),
not in any one document.

## What it is and isn't

**It is**

- A small function stored as data, in a document or in a workspace.
- Run only on a device you own, only when its document or workspace
  declares it and the device grants it. The app is always the arbiter of what runs and
  when (decided).
- Able to *show* a live value, or *keep* one in a document as an
  ordinary, synced, undoable edit.
- Expected to fail (offline, denied, too slow). The last kept value
  shows, marked as stale.

**It isn't**

- A server, or a way to make someone else's device run something.
  Nothing in the protocol lets an admin or an organisation run a
  function on a device it doesn't own (decided).
- A formula: a formula can't fetch or write.
- Part of the markdown, JSON Canvas or `.table` specs, beyond a reserved
  place and plain results.
- Unattended, unless a device has opted in to running it (an always-on
  node is such a device).

## In this folder

- [`model.md`](./model.md): how an action runs: arguments, triggers, results, limits
- [`syntax.md`](./syntax.md): stored as EDN, shown in other syntaxes
- [`in-files.md`](./in-files.md): where an action lives in markdown, `.table` and JSON Canvas
- [`credentials.md`](./credentials.md): connections and credentials, always-on nodes, trust
- [`prior-art.md`](./prior-art.md): Coda, Notion, Airtable, Excel, Sheets and others, compared
- [`status.md`](./status.md): what the stack has today, what's open, the first step

Up: [All docs](../README.md)
