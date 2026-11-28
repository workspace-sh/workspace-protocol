// The binding, loaded as the Linux app and the command line load it. The
// engine's own tests cover what it decides; these check what crosses into
// JavaScript: the one call, and the one that runs off the main thread.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const actions = require(`../native/actions.${process.platform}-${process.arch}.node`);
const call = (op, input) => JSON.parse(actions.call(op, JSON.stringify(input)));

test("call answers in JSON, and a mistake is an error, not a throw", () => {
  assert.deepEqual(call("jsonToEdn", { json: { lat: "53.3", "unit price": 2 } }), { edn: '{"unit price" 2 :lat "53.3"}' });
  assert.match(call("nope", {}).error, /isn't an operation/);
  assert.match(JSON.parse(actions.call("plan", "not json")).error, /isn't JSON/);
});

test("a run that needs a fetch says so, then finishes with the answer", async () => {
  const edn = `{:id :geo/place :needs {:fetch ["a.example"]} :fn (fn [{:keys [q]} env ctx] {:keep (:lat (env/fetch "https://a.example/s" {:q q}))})}`;
  const input = `{:request {:q "Dublin"} :granted {:fetch ["a.example"]}}`;
  const first = JSON.parse(await actions.callWithin("run", JSON.stringify({ edn, input }), 1000));
  assert.equal(first.status, "needs");
  assert.equal(first.request.href, "https://a.example/s?q=Dublin");
  const { answerEdn } = call("answer", { requestEdn: first.requestEdn, status: 200, body: '{"lat":"53.3498"}' });
  const second = JSON.parse(await actions.callWithin("run", JSON.stringify({ edn, input, answers: [[first.requestEdn, answerEdn]] }), 1000));
  assert.deepEqual([second.status, second.keepEdn], ["done", '"53.3498"']);
});

test("a run past its timeout is stopped, and the event loop stays free meanwhile", async () => {
  const edn = `{:id :t/spin :fn (fn [r] {:keep (reduce + 0 (map (fn [n] (reduce + 0 (range 1000))) (range 100000000)))})}`;
  let ticks = 0;
  const timer = setInterval(() => ticks++, 5);
  const started = Date.now();
  const out = JSON.parse(await actions.callWithin("run", JSON.stringify({ edn, input: "{}" }), 150));
  clearInterval(timer);
  assert.equal(out.status, "failed");
  assert.ok(["timeout", "limit"].includes(out.reason), out.reason);
  assert.ok(Date.now() - started < 3000);
  assert.ok(ticks > 5, `the loop ran ${ticks} times while it worked`);
});
