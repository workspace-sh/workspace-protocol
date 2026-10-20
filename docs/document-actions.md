# Document actions

Small functions that live inside a Workspace document, run in a sandbox
on a device that has agreed to run them, and can show a live value or
keep one in the document.

**Status:** a spike within this spec. Nothing here is decided unless it
says so, and nothing is built. It records the thinking so far on
documents carrying functions that work over Workspace's peer-to-peer
loop, what they could be used for, and prior art: naive on purpose, so
the thinking can move. Tracking: workspace-sh/workspace#699.

"Document action" (or "document function") describes the kind of thing
it is; it isn't an official name.

---

## Why it's here

A document action needs the protocol: a device's grant to run it, a
capability (UCAN) for each thing it may do, its runs recorded in the
document's log, and, when nobody's device is awake, a
[Lighthouse](./lighthouse.md). None of the file formats needs any of
that, so it lives with the protocol, not in a format's spec.

The line between the two:

| | Formula | Document action |
| --- | --- | --- |
| Example | `=SUM(values "spend")` | Fetch a place's coordinates |
| Reaches outside the document | Never | Only what it declares and the device grants |
| Who can compute it | Any client, Workspace or not | Workspace, on a device that agreed |
| Same inputs, same answer | Always | Not promised (the outside world changes) |
| Where it's specified | The file format (`.table`'s formulas, table-file-format#626) | Here |

A file format only reserves a place for an action and keeps its results
as ordinary content (see [Where it lives in a file](#where-it-lives-in-a-file)),
so a client that knows nothing of actions loses nothing.

## What it is and isn't

**It is**

- A small function stored in a document as data.
- Run only on a device you own, only when the document declares it and
  the device grants it. The app is always the arbiter of what runs and
  when (decided).
- Able to *show* a live value, or *keep* one in the document as an
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

## The model (proposed)

**A function of three arguments.** Shaped like a Ring handler and the
fetch handler most runtimes share (Cloudflare Workers, Deno, Bun, Hono:
`fetch(request, env, ctx)`), so it can line up with WinterTC (Ecma TC55)
and WASI HTTP later. Highly likely, not decided.

- `request`: what it's asked (the trigger's inputs: a row, a place name).
- `env`: what it's been granted, and nothing else.
  - `env/fetch`: GET to declared hosts.
  - `env/conn`: a named connection; the host attaches the credential.
  - `env/locate`, `env/now`.
  - `env/ask`: confirm or choose, on screen.
- `ctx`: this run. The trigger, where in the document, who and which
  device, locale, budget, the last kept value.

**Runs to completion.** A CPU budget in milliseconds; a few seconds of
wall time only while waiting on a fetch; no state between runs.

**Triggers.** Opening the document (`:on :open`, once per open), a tap,
an edit nearby, a timer while the document is open. `:fresh` says how
long a kept value is good for, so an open doesn't refetch what's fresh.
Nothing runs unless the document declares it and the device grants it.

**Two kinds of result.**

- `show`: drawn on this device only, never saved.
- `keep`: written into the document. Synced, undoable, and marked with
  where it came from.

**Effects are recorded, then applied.** A run produces a run record (its
inputs, what it fetched, what it was told, its result), and the write is
that record applied. Recorded results can be checked instead of re-run
(see [Trust](#trust)).

**Never.** Delete documents, leave its sandbox, outlive its run, open
sockets, reach paths outside the workspace, or write anything that isn't
an ordinary undoable edit.

## Syntax

One form is stored: **EDN**, data that reads as code, as `.table` stores
formulas (table-file-format#120, #626). What's on disk and in sync is
EDN. Any other syntax is presentation, converted both ways (decided).

The same action three ways: find a place's coordinates.

**Stored (EDN)**

```clojure
{:id :geo/place
 :on :open
 :fresh "P1D"
 :needs {:fetch ["nominatim.openstreetmap.org"]}
 :fn (fn [{:keys [q]} env ctx]
       (let [r (first (env/fetch "https://nominatim.openstreetmap.org/search"
                                 {:q q :format "json" :limit 1}))]
         {:keep [(:lat r) (:lon r)]}))}
```

**Shown like TypeScript**

```ts
action geo.place(q) on open, fresh 1d, needs fetch("nominatim.openstreetmap.org") {
  const r = (await env.fetch("https://nominatim.openstreetmap.org/search",
                             { q, format: "json", limit: 1 }))[0]
  keep([r.lat, r.lon])
}
```

**Shown like a formula** (only for one-expression actions)

```
=KEEP(LET(r, FETCH("https://nominatim.openstreetmap.org/search", "q", q, "limit", 1), {r.lat, r.lon}))
```

Safety comes from what `env` hands in, not from which keywords a syntax
leaves out: a restricted JavaScript would be no safer by itself.

**Open:** which surface (or surfaces) Workspace shows; whether the
formula-like one is worth it; how an agent writing actions changes the
answer (a hope, not a constraint).

## Where it lives in a file

The idea is Internet Explorer's conditional comments: put the action
where other readers already skip, and the result where they already
read. Every reader sees the result; only Workspace sees the action.

**Markdown**

```markdown
Dublin: 53.3498, -6.2603 <!--kept {:action :geo/place :at "2026-10-17T09:00Z"}-->

<!--action
{:id :geo/place :on :open :fresh "P1D" … }
-->
```

Any markdown reader shows "Dublin: 53.3498, -6.2603". A fenced
` ```action ` block works too, but other readers show it as code. An
HTML comment can't contain `-->`, so the EDN needs an escape for it.

**`.table`**

- An action in `schema.json` under a key other readers ignore, and its
  kept values as ordinary cells (a per-row field: an Open Library cover
  for each book).
- A button: an action on the selected rows.
- A view's action: writes many rows as one undo step.

Markdown gets these through `.table` embeds.

**JSON Canvas**

An action as a property of a node; an edge carries a value from one node
to the next (a small dataflow). Other canvas apps ignore unknown
properties.

**Open:** all of this. Placement is the least settled part.

## Connections and credentials

1. Secrets never live in the document. An action names a connection
   (`:conn/github`); the token stays in the device's secure store
   (Keychain, libsecret, Keystore).
2. The action never sees the token. The host attaches it below the
   sandbox, and only to the connection's declared hosts. Kinds: API key,
   bearer, JWT, OAuth with PKCE.
3. Kept results from a connection record their source, and ask before
   writing into a shared document.
4. In a team, in order of preference:
   1. each member brings their own credential (the default);
   2. a member delegates the *right to ask* (a UCAN), never the
      credential: their device runs it and writes a signed result;
   3. short-lived derived tokens encrypted to specific devices through
      the grant envelopes in [`permissions-model.md`](./permissions-model.md).
      Never the root secret.

   An action's rights are the intersection of the caller's rights in the
   document, what the action declares, and the connection's grant.
5. When every device that holds a connection is offline, the request
   waits in the document log, and the last kept value shows.

## Always-on nodes

A node that runs actions when people's devices are asleep is a
[Lighthouse](./lighthouse.md) that has opted in. One per workspace and
one per person or team (both, decided). Whether its default is to only
seed (hold and pass on blocks) or also to execute is reopened: too early
to tell until the stack shows it can.

## Trust

A kept result could be signed with who ran it (the node's key), under
what authority (the UCAN chain), which code (the action's hash), and
which inputs (their hash). Any peer can then check a result instead of
running it again. The same would cover a model run inside an action (a
model hash).

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
  ([`multi-writer.md`](./multi-writer.md)) is unbuilt, and the log has
  no request entry.
- **Headless:** a Node JSON-RPC child exists; no daemon, CLI or service
  identity.
- **Seeding:** content is sealed at the app layer and the membership gate
  admits any `workspace/*` UCAN, so blind seeding needs a
  `workspace/seed` capability.

Blockers, in short: a sandbox, multi-writer, invocations, the always-on
node, delegated secrets, and the web runtime.

## Prior art

What other tools call this and how they work, from their documentation
on 18 Oct 2026.

| | Their name | Runs where | Reaching outside | Credentials | Limits |
| --- | --- | --- | --- | --- | --- |
| Superhuman Docs (Coda) | Packs: formulas (flagged `isAction` when they change things), sync tables, MCP servers | Their service | Declared domains (`addNetworkDomain`) | OAuth2 or bearer, used through the host's fetcher | Not found |
| Notion | Buttons, database automations: fixed actions | Their service | A webhook (HTTP POST) only | None (no code) | Buttons on free plans |
| Airtable | "Run a script" (background), Scripting extension (foreground) | Their service | `fetch` to any host | Secrets, redacted from logs; the script reads them | 120 s, 512 MB, 50 fetches |
| Excel | Office Scripts (TypeScript); LAMBDA (pure) | The Excel app | `fetch` from the app only | None stored: keys end up in the script | Admin can block |
| Google Sheets | Custom functions (Apps Script) | Their service | URL Fetch | The owner's, implicitly | 30 s, writes only its own cells |
| Beaker Browser (archived 2022) | — | Peers held files, ran nothing | — | — | — |
| ICP canisters | Canisters | A consensus network | Yes | Paid in tokens | — |

How that compares with this proposal:

| | Here | Nearest elsewhere |
| --- | --- | --- |
| Runs on | A device you own | All run on the vendor's service, or in the app (Office Scripts) |
| Outside access | Declared hosts | Coda declares domains; Airtable and Office allow any |
| Credentials | Never seen by the action | Coda, probably; Airtable's scripts see theirs |
| Who allows it | Each device grants it | A creator or admin role |
| Failure | Normal; the last kept value, marked stale | Sheets: `#ERROR!` |
| A record of the run | Signed, checkable | None |

Worth borrowing: Coda's one flag between a formula and an action;
Airtable's published limits as a starting budget; Sheets giving a
trigger on open fewer rights than one from a tap; and Office Scripts'
lesson that without a credential store, people paste keys into code.

## Open

- The surface syntax or syntaxes.
- Placement in each file type.
- The sandbox, and where it lives.
- Whether run records go in the document's log.
- A name for actions across documents.
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
