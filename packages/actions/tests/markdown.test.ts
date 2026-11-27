// The host's half, on the engine's real binding (built by
// `crates/actions-node`'s `npm run build`), with fetch stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
    bindingFile,
    hostPerformer,
    keptText,
    loadBinding,
    readMarkdown,
    refreshMarkdown,
    runToEnd,
    unescapeComment,
} from "../src/index.ts";

const b = loadBinding(fileURLToPath(new URL(`../../../crates/actions-node/native/${bindingFile()}`, import.meta.url)));

const DOC = `# Places

Dublin: <!--[kept geo/place {:q "Dublin"} 2026-11-25T09:00Z]-->53.3498, -6.2603<!--[/kept]-->
Galway: <!--[kept geo/place {:q "Galway"}]--><!--[/kept]-->

<!--action
{:id :geo/place :on :open :fresh "P1D"
 :needs {:fetch ["nominatim.openstreetmap.org"]}
 :fn (fn [{:keys [q]} env ctx]
       (let [r (first (env/fetch "https://nominatim.openstreetmap.org/search"
                                 {:q q :format "json" :limit 1}))]
         {:keep [(:lat r) (:lon r)]}))}
-->
`;

const PLACES: Record<string, { lat: string; lon: string }> = {
    Dublin: { lat: "53.3498", lon: "-6.2603" },
    Galway: { lat: "53.2707", lon: "-9.0568" },
};

let fetched: string[] = [];
const stubFetch = (async (url: URL) => {
    fetched.push(url.toString());
    const place = PLACES[url.searchParams.get("q") ?? ""];
    return new Response(JSON.stringify(place ? [place] : []), { headers: { "content-type": "application/json" } });
}) as unknown as typeof fetch;

const perform = hostPerformer(b, { locale: "en-IE", currency: "EUR", fetch: stubFetch });
const grantAll = (a: { fetch: string[]; read: string[] }) => ({ fetch: a.fetch, read: a.read, locate: false, ask: false });

test("it reads the action and both kept values, one not yet run", () => {
    const doc = readMarkdown(b, DOC);
    assert.deepEqual([...doc.actions.keys()], ["geo/place"]);
    assert.deepEqual(
        doc.kept.map((k) => [k.inputs, k.at, k.value]),
        [
            ['{:q "Dublin"}', "2026-11-25T09:00Z", "53.3498, -6.2603"],
            ['{:q "Galway"}', null, ""],
        ],
    );
});

test("opening it runs what's due and writes it back, leaving the rest of the text alone", async () => {
    fetched = [];
    const now = new Date("2026-11-25T15:00:00Z"); // Dublin ran six hours ago: still fresh
    const r = await refreshMarkdown(b, DOC, { now, localZone: null, grants: grantAll, perform, timeoutMs: 2000 });
    assert.equal(fetched.length, 1);
    assert.match(fetched[0] ?? "", /q=Galway/);
    assert.ok(r.text.includes(`Galway: <!--[kept geo/place {:q "Galway"} 2026-11-25T15:00:00Z]-->53.2707, -9.0568<!--[/kept]-->`));
    assert.ok(r.text.includes(`Dublin: <!--[kept geo/place {:q "Dublin"} 2026-11-25T09:00Z]-->53.3498, -6.2603<!--[/kept]-->`));
    assert.equal(r.text.replace(/<!--\[kept[\s\S]*?\[\/kept\]-->/g, ""), DOC.replace(/<!--\[kept[\s\S]*?\[\/kept\]-->/g, ""));
});

test("without the grant nothing is fetched, and the app learns what to ask for", async () => {
    fetched = [];
    const none = () => ({ fetch: [], read: [], locate: false, ask: false });
    const r = await refreshMarkdown(b, DOC, { now: new Date(), localZone: null, grants: none, perform, timeoutMs: 2000 });
    assert.equal(fetched.length, 0);
    assert.equal(r.text, DOC);
    assert.deepEqual(r.ungranted.get("geo/place")?.fetch, ["nominatim.openstreetmap.org"]);
});

test("offline keeps the last value and says so", async () => {
    const offline = hostPerformer(b, {
        locale: "en-IE",
        currency: "EUR",
        fetch: (async () => {
            throw new TypeError("fetch failed");
        }) as unknown as typeof fetch,
    });
    const r = await refreshMarkdown(b, DOC, { now: new Date("2026-12-01T00:00:00Z"), localZone: null, grants: grantAll, perform: offline, timeoutMs: 2000 });
    assert.equal(r.text, DOC);
    const ran = r.results.filter((x) => x.ran);
    assert.equal(ran.length, 2);
    for (const x of ran) assert.ok(x.ran && x.outcome.status === "failed" && x.outcome.reason === "offline");
});

test("a request that never answers fails the run at its timeout", async () => {
    const hang = () => new Promise<never>(() => {});
    const a = `{:id :t/x :needs {:fetch ["a.example"]} :fn (fn [r] {:keep (env/fetch "https://a.example/")})}`;
    const started = Date.now();
    const out = await runToEnd(b, a, { granted: { fetch: ["a.example"] }, timeoutMs: 200 }, hang);
    assert.ok(Date.now() - started < 1500);
    assert.equal(out.status, "failed");
    assert.ok(out.status === "failed" && out.reason === "timeout");
});

test("a currency is formatted by the host, in its locale", async () => {
    const a = `{:id :t/x :fn (fn [r] {:keep (env/format :currency 19263)})}`;
    const out = await runToEnd(b, a, { granted: {}, timeoutMs: 1000 }, perform);
    assert.ok(out.status === "done" && out.keep !== null);
    assert.equal(keptText(b, out.keep), "€19,263.00");
});

test("kept text never opens a tag", () => {
    assert.equal(keptText(b, `"<!-- a & b -->"`), "&lt;!-- a &amp; b -->");
    assert.equal(keptText(b, `{:a 1}`), "{:a 1}");
});

test("a comment's escapes come back as < and >, inside strings only", () => {
    assert.equal(unescapeComment(String.raw`{:s "a <b>" :t "\\u003c"}`), String.raw`{:s "a <b>" :t "\\u003c"}`);
});

test("an action that can't be read is a problem, not a crash", () => {
    const doc = readMarkdown(b, "<!--action\n{:id 1}\n-->");
    assert.equal(doc.actions.size, 0);
    assert.equal(doc.problems.length, 1);
});
