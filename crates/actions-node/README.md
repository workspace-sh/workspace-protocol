# workspace-actions-node

The actions engine (`crates/actions`) as a native Node add-on (N-API), for
the Linux app and the command line.

```sh
npm run build   # cargo build --release, then native/actions.<platform>-<arch>.node
npm test
```

```js
const actions = require("./native/actions.linux-x64.node");

JSON.parse(actions.call("plan", JSON.stringify({ format: "markdown", text, event: "open", now, grants: {} })));
// → { runs: […], held: […], ungranted: […], problems: […] }

JSON.parse(await actions.callWithin("run", JSON.stringify({ edn, input }), 5000));
// → { status: "needs", request: { op: "fetch", href: "https://…" }, … }
```

- `call(op, input)` runs an operation now and returns JSON text.
- `callWithin(op, input, timeoutMs)` runs it on a worker thread and stops it
  after the timeout: for `run` and `check`, which take as long as the action
  does. It never rejects.

Neither throws for a mistake in the input: that's `{"error": "…"}`. The
operations are the engine's own (`crates/actions/src/api.rs`).
[`packages/actions`](../../packages/actions) wraps them for a host.

Workspace's apps load one native library for both `.table` formulas and
actions. This add-on is the Linux build of the actions half until the two
are packaged together.
