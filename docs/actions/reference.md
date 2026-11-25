# Reference

Every name an action uses, and where each file format keeps it. The
names are the same in every format; only the place that holds them
differs. Decided 25 Nov 2026 unless marked **proposed**.

## Markers

| Name | What it holds |
| --- | --- |
| `action` | An action's definition, in EDN |
| `kept` | A kept value: the action that made it, its inputs, and when it ran |

## An action's keys

| Key | What it says | Example |
| --- | --- | --- |
| `:id` | Its name: a keyword, unique where it's defined | `:geo/place` |
| `:on` | When it runs (see [Triggers](#triggers)) | `:open` |
| `:fresh` | How long a kept value is good for: an ISO 8601 duration | `"P1D"` |
| `:needs` | What it may ask for (see [Requests](#requests)) | `{:fetch ["nominatim.openstreetmap.org"]}` |
| `:fn` | The function: `(fn [request env ctx] …)` | |

A key this version doesn't know is kept and ignored, so a later version
can add one.

## Triggers

**In a document**, triggered by the document:

| Trigger | When |
| --- | --- |
| `:open` | Once each time the document opens |
| `:tap` | When someone taps its mark |
| `[:edit "isbn"]` | When that field (or that text) changes |
| `[:change "budget.table"]` | When that file changes |

**On a clock.** These follow what serverless platforms already use:
AWS EventBridge Scheduler's `at()` and `cron()` with a time-zone field,
and the five-field cron of Cloudflare Workers, Google Cloud Scheduler
and Vercel.

| Trigger | When |
| --- | --- |
| `[:at "2026-11-26T09:00:00+01:00[Europe/Madrid]"]` | Once, at that moment. RFC 9557, the form JavaScript's Temporal uses: a time, its offset, and the named zone |
| `[:cron {:minute 0 :hour 9 :weekday [:mon :tue :wed :thu :fri]}]` | On a schedule, in UTC |
| `[:cron {…} :tz "Europe/Madrid"]` | On a schedule, in a named IANA zone, so it follows that zone's daylight saving |
| `[:cron {…} :tz :local]` | On a schedule, in each member's own zone, run for each of them |
| `[:cron "0 9 * * 1-5"]` | A plain five-field cron string, read as the same map |

The cron map names cron's fields, so it converts to and from a cron
string exactly:

| Key | Values | Left out |
| --- | --- | --- |
| `:millisecond` | 0–999 | 0 |
| `:second` | 0–59 | 0 |
| `:minute` | 0–59 | `*` |
| `:hour` | 0–23 | `*` |
| `:day` | 1–31, the day of the month | `*` |
| `:month` | 1–12, or `:jan` … `:dec` | `*` |
| `:weekday` | `:mon` … `:sun`, or 0–6 with Sunday as 0 | `*` |

A value is a number, a list of them (`[:mon :fri]`), or cron's own text
for a step or range (`"*/15"`, `"9-17"`). Seconds and milliseconds go
beyond cron and default to 0, so a map without them runs when cron
would. When the clocks change, a time that's skipped runs at the first
moment after the jump, and a time that happens twice runs once, as
iCalendar does (RFC 5545).

**Proposed:** a trigger on new data from a source (prices, a feed), so
an action runs when the source changes rather than polling a fast clock.

## Requests

An action only asks. Everything outside its own computation is a
request the app performs, if the action declares it in `:needs` and the
device grants it.

| Request | Does | Needs |
| --- | --- | --- |
| `(env/fetch url query)` | HTTP GET, with query parameters as a map | The host, in `:fetch` |
| `(env/fetch url query {:method :post :body …})` | HTTP POST | The host and method in `:fetch`: **proposed** |
| `(env/read path)` | Read another file in the workspace, by relative path | The path, in `:read` |
| `(env/write path content)` | Make or change a file, as an ordinary undoable edit | The path, in `:write`: **proposed** |
| `(env/now)` | The time | Nothing |
| `(env/format kind value)` | Format a value: a currency, a date | Nothing |
| `(env/locate)` | Where this device is | `:locate true` |
| `(env/ask question choices)` | Ask the person to confirm or choose | `:ask true` |
| `(env/conn name)` | Use a named connection; the app adds the credential | The connection, in `:conn`: **later** |

A request comes back as a value, or fails as one: `:offline`,
`:timeout`, `:denied` or `:error`. A failed run keeps the last kept
value, marked stale.

## Results

| Result | Means |
| --- | --- |
| `{:keep v}` | Written into the document: synced, undoable, and marked with where it came from |
| `{:show v}` | Drawn on this device only, never saved |

An action returns either or both.

## The language

A small, pure part of Clojure over EDN values, with Clojure's names:

- Forms: `let`, `if`, `when`, `do`, `and`, `or`, `fn`.
- Functions: `=`, `not=`, `<`, `>`, `<=`, `>=`, `+`, `-`, `*`, `/`, `not`, `nil?`, `empty?`, `count`, `first`, `second`, `last`, `rest`, `nth`, `get`, `get-in`, `assoc`, `contains?`, `keys`, `vals`, `str`, `map`, `filter`, `reduce`, `sum`, `min`, `max`, `round`, `parse-number`.
- A keyword looks itself up in a map: `(:lat r)`.

There's no mutation and nothing that outlives a run.

## Where each format keeps them

| Format | `action` | `kept` |
| --- | --- | --- |
| Markdown | `<!--action … -->` | `<!--[kept geo/place {:q "Dublin"} 2026-11-25T09:00Z]-->53.3498, -6.2603<!--[/kept]-->` |
| TextPack | The same, in its text file | The same |
| TextBundle | The same, in its text file | The same |
| JSON Canvas | `"x-action"` on a node or edge | The node's own `text` |
| `.table` | `"x-actions"` in `schema.json`, by id; a field names its action with `"x-action"` | The cell itself, plus `"x-kept"` in the row |
| A workspace | Beside its policy, synced through its log | The files it writes |
| Plain text | None: a `.txt` file has nowhere to keep one | None |

Each reader that doesn't know actions skips the comment or the `x-` key
and reads the kept value as ordinary content. See
[Where an action lives in a file](./in-files.md).

Up: [Workspace actions](./README.md) · [All docs](../README.md)
