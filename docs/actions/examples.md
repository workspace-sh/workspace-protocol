# Three worked examples

The first step from [Where it stands](./status.md): three actions written out, with how each reads offline. Nothing here is built.

## Example 1. Markdown: a place's coordinates

**Source document**

```markdown
## Trip

Dublin: <!--[kept geo/place r7f2 2026-11-02T09:00Z]-->53.3498, -6.2603<!--[/kept]-->
Galway: <!--[kept geo/place r7f3 2026-11-02T09:00Z]-->53.2707, -9.0568<!--[/kept]-->

<!--[if !workspace]>-->
Open this note in Workspace to keep these coordinates up to date.
<!--<![endif]-->
```

| | What's shown |
| --- | --- |
| Workspace, online | `Dublin: 53.3498, -6.2603` with a small mark: kept today |
| Workspace, offline, value 3 days old | The same value, marked stale: "From 30 Oct. Can't check now." |
| Any other Markdown app | `Dublin: 53.3498, -6.2603`, and "Open this note in Workspace…" |
| A device that hasn't granted it | The same value. Tapping the mark offers the grant. |

Nominatim asks for at most one request a second and an identifying `User-Agent`. The app sets both, not the action.

## Example 2. `.table`: a cover for each book

| title | isbn | cover |
| --- | --- | --- |
| Dune | 9780441013593 | `https://covers.openlibrary.org/b/isbn/9780441013593-M.jpg` |
| The Left Hand of Darkness | 9780441478125 | `https://covers.openlibrary.org/b/isbn/9780441478125-M.jpg` |
| Piranesi | 9781635575637 | *(waiting: added offline)* |

- **Trigger:** an edit to `isbn` (`[:edit "isbn"]`), so typing an ISBN fills its cover.
- **Fresh:** 30 days. An open doesn't refetch.
- **Offline:** the row keeps an empty cover. The request waits and runs when the device is online and the table is open.
- **In another `.table` reader:** `cover` is an ordinary string column.

## Example 3. Canvas: an edge carrying a total

```
[ household-budget.table ] ──(sum of amount)──▶ [ Total: £19,263 ]
```

- **Trigger:** a change in the file the edge comes from.
- **Needs:** read access to `household-budget.table`, by relative path.
- **Kept:** the text node's `text`. Obsidian and other canvas apps show "Total: £19,263".

<details>
<summary>Example 3 in the TypeScript-like surface</summary>

```ts
action canvas.total(from: table) on change(from),
    needs read("household-budget.table") {
  keep(`Total: ${env.format("currency", sum(values(from, "amount")))}`)
}
```

</details>


Up: [Workspace actions](./README.md) · [All docs](../README.md)
