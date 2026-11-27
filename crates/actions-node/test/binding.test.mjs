// The binding, loaded as the Linux app and the CLI load it. The engine's own
// tests cover the language; these check what crosses into JavaScript.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const actions = require(`../native/actions.${process.platform}-${process.arch}.node`);

const GEO_PLACE = `
{:id :geo/place
 :on :open
 :fresh "P1D"
 :needs {:fetch ["nominatim.openstreetmap.org"]}
 :fn (fn [{:keys [q]} env ctx]
       (let [r (first (env/fetch "https://nominatim.openstreetmap.org/search"
                                 {:q q :format "json" :limit 1}))]
         {:keep [(:lat r) (:lon r)]}))}`;

const GRANTED = `{:fetch ["nominatim.openstreetmap.org"]}`;
const REQUEST = `{:op :fetch :url "https://nominatim.openstreetmap.org/search" :query {:q "Dublin" :format "json" :limit 1}}`;

test("a run that needs a fetch says so, then finishes with the answer", async () => {
  const first = await actions.run(GEO_PLACE, `{:request {:q "Dublin"} :granted ${GRANTED}}`, 1000);
  assert.match(first, /:status :needs/);
  assert.match(first, /:request \{:op :fetch /);

  const second = await actions.run(
    GEO_PLACE,
    `{:request {:q "Dublin"} :granted ${GRANTED}
      :answers [[${REQUEST} {:value [{:lat "53.3498" :lon "-6.2603"}]}]]}`,
    1000,
  );
  assert.match(second, /:status :done/);
  assert.match(second, /:keep \["53\.3498" "-6\.2603"\]/);
});

test("a mistake in the action is a failed outcome, not a rejection", async () => {
  const out = await actions.run(`{:id :t/x :fn (fn [r] (cuont [1]))}`, `{}`, 1000);
  assert.match(out, /:status :failed/);
  assert.match(out, /:suggestions \["count"\]/);
});

test("the timeout stops a long run, and the event loop stays free meanwhile", async () => {
  const slow = `{:id :t/slow :fn (fn [r] {:keep (reduce + (map (fn [i] (reduce + (range 1000000))) (range 1000000)))})}`;
  let ticks = 0;
  const timer = setInterval(() => ticks++, 10);
  const started = Date.now();
  const out = await actions.run(slow, `{}`, 300);
  clearInterval(timer);
  assert.match(out, /:reason :timeout/);
  assert.ok(Date.now() - started < 2000, "stopped near its timeout");
  assert.ok(ticks >= 5, `timers ran while it worked (${ticks})`);
});

test("a clock is due once per slot", () => {
  const daily = `{:id :t/daily :on [:cron "0 9 * * *" :tz "Europe/Madrid"] :fn (fn [r] {:keep 1})}`;
  assert.equal(
    actions.due(daily, null, "2026-11-27T08:30:00Z", null),
    `{:due :now :slot "2026-11-27T08:00:00Z"}`,
  );
  assert.match(
    actions.due(daily, "2026-11-27T08:00:00Z", "2026-11-27T08:30:00Z", null),
    /^\{:due :later :until "2026-11-28T08:00:00Z" :why /,
  );
});

test("a document trigger is due unless its kept value is fresh", () => {
  assert.equal(actions.due(GEO_PLACE, null, "2026-11-27T08:30:00Z", null), "{:due :now}");
  assert.match(
    actions.due(GEO_PLACE, "2026-11-27T08:00:00Z", "2026-11-27T08:30:00Z", null),
    /^\{:due :later :until "2026-11-28T08:00:00Z"/,
  );
});

test("a bad time or action throws", () => {
  assert.throws(() => actions.due(GEO_PLACE, null, "yesterday", null), /RFC 3339/);
  assert.throws(() => actions.due(`{:id 1}`, null, "2026-11-27T08:30:00Z", null));
});
