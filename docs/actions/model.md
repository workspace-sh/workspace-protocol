# The model (proposed)

How an action runs: its arguments, triggers, results, and what it may never do.

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
(see [Trust](./credentials.md#trust)).

**Never.** Delete documents, leave its sandbox, outlive its run, open
sockets, reach paths outside the workspace, or write anything that isn't
an ordinary undoable edit.

Up: [Workspace actions](./README.md) · [All docs](../README.md)
