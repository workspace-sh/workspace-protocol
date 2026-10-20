# Syntax

How an action is written: stored as EDN, shown in other syntaxes.

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

Up: [Workspace actions](./README.md) · [All docs](../README.md)
