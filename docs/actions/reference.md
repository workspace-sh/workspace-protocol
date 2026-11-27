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

## A run's `ctx`

What the third argument holds. The app supplies what it knows (its
locale, the member, the device, its timeout) and the engine adds the
rest.

| Key | What it holds |
| --- | --- |
| `:trigger` | What ran it: `:open`, `:tap`, `:clock`, `[:edit "isbn"]` or `[:change "budget.table"]` |
| `:action` | The action's id, as a keyword |
| `:place` | Which kept value this run is for: `"m:0"` (a document's first marker), `"n:<node id>"`, `"r:<row id>:<field>"` |
| `:last`, `:last-at` | The value kept now and when it was kept, if it has run before |
| `:slot` | The moment a clock run is for |
| `:locale` and others | Whatever the app supplied |

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
would. When the clocks change, a time that's skipped moves forward by
the length of the gap (02:30 on a night that jumps from 02:00 to 03:00
runs at 03:30), and a time that happens twice runs once, at its first.
This is what iCalendar does (RFC 5545).

**Proposed:** a trigger on new data from a source (prices, a feed), so
an action runs when the source changes rather than polling a fast clock.

## Requests

An action only asks. Everything outside its own computation is a
request the app performs, if the action declares it in `:needs` and the
device grants it.

| Request | Does | Needs |
| --- | --- | --- |
| `(env/fetch url query)` | HTTP GET, with query parameters as a map | The host, in `:fetch` |
| `(env/fetch url query {:method :post :body … :headers {…}})` | Send: POST, PUT, PATCH or DELETE (and HEAD, which only reads) | The method and host, in `:fetch`: `[:post "api.example.org"]` |
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

A fetch's answer is the response read as JSON, or its text when it isn't
JSON. A response outside 200–299 fails as `:error`. A query's names are
sent in sorted order, so every device asks for the same address.
[Fetching](./http.md) says exactly what goes on the wire, and the rules
every device holds a fetch to.

What `env/read` gives, by format:

| File | Gives |
| --- | --- |
| Markdown, plain text | Its text |
| JSON Canvas, JSON | Its JSON, as EDN maps |
| `.table` | `{:fields […] :rows […]}` for its first table, and every table by name under `:tables` |

A row is a map from field name to value. In every map made from JSON, a
name that's a valid keyword is a keyword (`(:amount row)`), and any
other name stays a string (`(get row "unit price")`).

## Results

| Result | Means |
| --- | --- |
| `{:keep v}` | Written into the document: synced, undoable, and marked with where it came from |
| `{:show v}` | Drawn on this device only, never saved |

An action returns either or both.

A run that doesn't finish fails, and says why:

| Reason | Means |
| --- | --- |
| `:offline`, `:timeout`, `:denied`, `:error` | A request failed that way |
| `:timeout` | The runner stopped the run: it took longer than that runner allows |
| `:refused` | It asked for something outside what it declares in `:needs`, or this device hasn't granted it |
| `:limit` | It nested or grew past what the runner allows to protect itself |
| `:failed` | A mistake in the action itself |

A failure carries a message and, when something was misnamed,
suggestions: `(cuont xs)` fails with `count` suggested, and a fetch from a
host the action doesn't declare suggests the host it does.

## Run records

A run that ends has a record: what it was given, what it asked and was
told, and how it came out.

```clojure
{:v 1 :action :geo/place :place "m:0" :at "2026-11-27T10:00:00Z"
 :request {:q "Dublin"} :ctx {…} :granted {…}
 :asked [[{:op :fetch :url "…" :query {…}} {:value [{:lat "53.3498" :lon "-6.2603"}]}]]
 :result {:keep ["53.3498" "-6.2603"]}}
```

An action is pure apart from what it asks, so running it again with the
record's own answers gives the record's result. That's how a record is
checked without performing anything again. A failed run's `:result` is
`{:failed :offline :message "…"}`. A clock run's record also has `:slot`.

In a document, the `kept` marker is the short form every reader sees:
the action, its inputs and when it ran.

## The language

A small, pure part of Clojure over EDN values, with Clojure's names:

- Forms: `let`, `if`, `when`, `do`, `and`, `or`, `fn`.
- Functions: `=`, `not=`, `<`, `>`, `<=`, `>=`, `+`, `-`, `*`, `/`, `not`, `nil?`, `empty?`, `string?`, `number?`, `map?`, `vector?`, `count`, `first`, `second`, `last`, `rest`, `nth`, `get`, `get-in`, `assoc`, `contains?`, `keys`, `vals`, `vector`, `hash-map`, `concat`, `range`, `str`, `map`, `filter`, `reduce`, `sum`, `min`, `max`, `round`, `parse-number`.
- A keyword looks itself up in a map: `(:lat r)`.

There's no mutation and nothing that outlives a run.

## Where each format keeps them

| Format | `action` | `kept` |
| --- | --- | --- |
| Markdown | `<!--action … -->` | `<!--[kept geo/place {:q "Dublin"} 2026-11-25T09:00Z]-->53.3498, -6.2603<!--[/kept]-->` |
| TextPack | The same, in its text file | The same |
| TextBundle | The same, in its text file | The same |
| JSON Canvas | `"x-actions"` at the top, by id; a text node names its action with `"x-action"` | The node's own `text`, plus `"x-kept"` on the node |
| `.table` | `"x-actions"` in `schema.json`, by id; a field names its action with `"x-action"` | The cell itself, plus `"x-kept"` in the row |
| A workspace | Beside its policy, synced through its log | The files it writes |
| Plain text | None: a `.txt` file has nowhere to keep one | None |

Each reader that doesn't know actions skips the comment or the `x-` key
and reads the kept value as ordinary content. See
[Where an action lives in a file](./in-files.md).

Up: [Workspace actions](./README.md) · [All docs](../README.md)
