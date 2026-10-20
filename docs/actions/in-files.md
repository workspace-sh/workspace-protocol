# Where an action lives in a file

Placement in markdown, `.table` and JSON Canvas.

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

Up: [Workspace actions](./README.md) · [All docs](../README.md)
