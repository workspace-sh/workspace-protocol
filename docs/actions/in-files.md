# Where an action lives in a file

Placement in Markdown (and TextBundle and TextPack), JSON Canvas and
`.table`. Decided 25 Nov 2026; [Reference](./reference.md) lists every name.

The idea is Internet Explorer's conditional comments: put the action
where other readers already skip, and the result where they already
read. Every reader sees the result; only Workspace sees the action.

## Markdown, TextBundle and TextPack

```markdown
Dublin: <!--[kept geo/place {:q "Dublin"} 2026-11-25T09:00Z]-->53.3498, -6.2603<!--[/kept]-->
Galway: <!--[kept geo/place {:q "Galway"} 2026-11-25T09:00Z]-->53.2707, -9.0568<!--[/kept]-->

<!--action
{:id :geo/place :on :open :fresh "P1D"
 :needs {:fetch ["nominatim.openstreetmap.org"]}
 :fn (fn [{:keys [q]} env ctx] …)}
-->
```

- **The kept value is wrapped,** between `<!--[kept …]-->` and
  `<!--[/kept]-->`, so an action replaces exactly that text and nothing
  else.
- **The opening marker carries the action, its inputs and when it
  ran.** One action defined once serves every place that uses it, each
  with its own inputs: here, a `q` for each city.
- **Escaping:** an HTML comment can't contain `<!--`, `-->` or `--!>`. In
  an action block, a writer writes every `<` and `>` inside a string as
  `\u003c` and `\u003e`, which EDN reads back as the same characters,
  and a symbol containing `-->` is refused. The EDN can then never end
  the comment.
- **A marker without a time** is a place that hasn't run yet, as a
  person writes one: `<!--[kept geo/place {:q "Cork"}]-->…<!--[/kept]-->`.
- **Code is never read.** A marker or an action inside a fenced block or
  an inline code span is text about actions, so a document can explain
  them without running anything.
- **A kept value** is written as a person would write it: a string as
  itself, a list of numbers or strings joined by `, `. `&` and `<` are
  written as entities, so a value can't open a tag or a comment.
- TextBundle and TextPack keep both in their text file, exactly as
  Markdown does, so the three stay one format for actions.

## `.table`

```json
"fields": [{ "name": "cover", "type": "string", "x-action": "books/cover" }],
"x-actions": { "books/cover": "{:id :books/cover :on [:edit \"isbn\"] :fresh \"P30D\" …}" }
```

A row keeps the value as an ordinary cell, and what made it beside it:

```json
{ "id": "r1", "isbn": "9780441013593", "cover": "https://covers.openlibrary.org/b/isbn/9780441013593-M.jpg",
  "x-kept": { "cover": { "action": "books/cover", "at": "2026-11-25T09:00Z", "from": { "isbn": "9780441013593" } } } }
```

The value and where it came from change in one edit, so undo and sync
never part them. Another reader, or a CSV export, sees an ordinary
`cover` column.

- **An action's inputs are its row,** as a map from field name to value,
  without the cell it fills.
- **`from` records the cell an `[:edit …]` trigger watches,** as it was
  when the value was made. When the row's cell no longer matches it, the
  value is out of date and the action runs the next time the table
  opens. An edit made in any app, Workspace or not, is caught this way.
  A row whose watched cell is empty doesn't run.
- **Writing a value changes that row's line and nothing else:** the
  other rows, and the row's own key order and spacing, stay byte for
  byte as they were.

Still to place: a button (an action on the selected rows) and a view's
action (many rows as one undo step).

## JSON Canvas

```json
{ "nodes": [
    { "id": "total", "type": "text", "text": "Total: £19,263",
      "x-action": "canvas/total",
      "x-kept": { "action": "canvas/total", "at": "2026-11-25T09:00:00Z" } } ],
  "x-actions": { "canvas/total": "{:id :canvas/total :on [:change \"household-budget.table\"] …}" } }
```

The kept value is a text node's own `text`, which every canvas app
shows. The canvas holds its actions by id in `"x-actions"`, as a
`.table` does, and a node names the one that fills it with `"x-action"`
(or holds the action's EDN there itself). `"x-kept"` records the run:
the action, when it ran, and its inputs as `"from"` when it takes any.
Only a text node can keep a value. Writing one changes that node's
`text` and `x-kept` and no other byte, so the file stays laid out as
the app that made it left it. Other canvas apps ignore unknown
properties.

Still to place: what an edge carries (`"x-carries"`), a small dataflow
between nodes.

## A workspace

A workspace's own actions are kept beside its policy and synced through
its log; what they make are ordinary files. How they are stored, and
who may add one, is still to design.

## Plain text

None. A `.txt` file has no comment to hide an action in.

Up: [Workspace actions](./README.md) · [All docs](../README.md)
