// The host package against the real engine: a document opens, its actions
// run, and their values are written back. What the engine decides is tested
// in `crates/actions`; this checks the host's half, performing and passing on.
import assert from "node:assert/strict";
import { test } from "node:test";
import { describe, findBinding, hostPerformer, refresh, type Perform } from "../src/index.ts";

const found = findBinding();
if (found === null) throw new Error("build the binding first: npm run build in crates/actions-node");
const b = found;

const TRIP = `# Trip

Dublin: <!--[kept geo/place {:q "Dublin"}]-->not looked up yet<!--[/kept]-->
Total: <!--[kept trip/total {:items [14400 4863]}]-->?<!--[/kept]-->

<!--action
{:id :geo/place :on :open :fresh "P1D"
 :needs {:fetch ["nominatim.openstreetmap.org"]}
 :fn (fn [{:keys [q]} env ctx]
       (let [r (first (env/fetch "https://nominatim.openstreetmap.org/search" {:q q :format "json" :limit 1}))]
         {:keep [(:lat r) (:lon r)]}))}
-->

<!--action
{:id :trip/total :on :open
 :fn (fn [{:keys [items]} env ctx] {:keep (str (env/format :currency (sum items)) " across " (count items))})}
-->
`;

const now = new Date("2026-11-27T10:00:00Z");
const asked: string[] = [];
const fakeFetch = (async (href: string | URL | Request) => {
    asked.push(String(href));
    return new Response(JSON.stringify([{ lat: "53.3498", lon: "-6.2603" }]), { headers: { "content-type": "application/json" } });
}) as typeof fetch;
const perform: Perform = hostPerformer({ locale: "en-GB", currency: "GBP", fetch: fakeFetch });
const textOf = (r: { doc: { format: string; text?: string } }): string => r.doc.text ?? "";

test("describe reads an action without running it", () => {
    const d = describe(b, `{:id :t/x :on [:edit "isbn"] :needs {:read ["a.md"]} :fn (fn [r] {:keep 1})}`);
    assert.deepEqual(d, { id: "t/x", on: "edit", of: "isbn", fresh: null, needs: { fetch: [], read: ["a.md"], locate: false, ask: false } });
});

test("an action this device hasn't granted waits, and the rest run", async () => {
    const r = await refresh(b, { format: "markdown", text: TRIP }, { event: "open", now, zone: "Europe/Madrid", grants: {}, perform, timeoutMs: 5000 });
    assert.deepEqual(r.ungranted.map((u) => [u.action, u.fetch, u.keys]), [["geo/place", ["nominatim.openstreetmap.org"], ["m:0"]]]);
    assert.match(textOf(r), /<!--\[kept trip\/total \{:items \[14400 4863\]\} 2026-11-27T10:00:00Z\]-->£19,263\.00 across 2<!--\[\/kept\]-->/);
    assert.match(textOf(r), /not looked up yet/);
    assert.equal(asked.length, 0, "nothing was fetched without the grant");
});

test("with the grant, the host fetches the address the engine built and the value is kept", async () => {
    const r = await refresh(
        b,
        { format: "markdown", text: TRIP },
        { event: "open", now, zone: null, grants: { "geo/place": { fetch: ["nominatim.openstreetmap.org"] } }, perform, timeoutMs: 5000 },
    );
    assert.deepEqual(asked, ["https://nominatim.openstreetmap.org/search?format=json&limit=1&q=Dublin"]);
    assert.match(textOf(r), /<!--\[kept geo\/place \{:q "Dublin"\} 2026-11-27T10:00:00Z\]-->53\.3498, -6\.2603<!--\[\/kept\]-->/);
    assert.equal(r.results.length, 2);
    assert.ok(r.results.every((x) => x.record.startsWith("{")), "each run has its record");
});

test("a failed fetch keeps the last value and says why", async () => {
    const down = hostPerformer({
        locale: "en-GB",
        currency: "GBP",
        fetch: (async () => {
            throw new TypeError("fetch failed");
        }) as typeof fetch,
    });
    const r = await refresh(
        b,
        { format: "markdown", text: TRIP },
        { event: "open", now, zone: null, grants: { "geo/place": { fetch: ["nominatim.openstreetmap.org"] } }, perform: down, timeoutMs: 5000 },
    );
    const place = r.results.find((x) => x.run.action === "geo/place");
    assert.deepEqual([place?.outcome.status, place?.outcome.status === "failed" && place.outcome.reason], ["failed", "offline"]);
    assert.match(textOf(r), /not looked up yet/);
});

test("a run that never ends is stopped by the runner's timeout", async () => {
    const doc = `<!--[kept t/spin]-->x<!--[/kept]-->\n<!--action\n{:id :t/spin :on :open :fn (fn [r] {:keep (reduce + 0 (map (fn [n] (reduce + 0 (range 1000))) (range 100000000)))})}\n-->`;
    const r = await refresh(b, { format: "markdown", text: doc }, { event: "open", now, zone: null, grants: {}, perform, timeoutMs: 200 });
    const o = r.results[0]?.outcome;
    assert.ok(o?.status === "failed" && (o.reason === "timeout" || o.reason === "limit"), JSON.stringify(o));
});
