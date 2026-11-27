# workspace-actions-node

The actions engine (`crates/actions`) as a native Node add-on (N-API), for the
Linux app and the CLI.

```sh
npm run build   # cargo build --release, then native/actions.<platform>-<arch>.node
npm test
```

```js
const actions = require("./native/actions.linux-x64.node");

await actions.run(actionEdn, inputEdn, 5000);
// → '{:asked [] :request {:op :fetch …} :status :needs}'

actions.due(actionEdn, lastRun, new Date().toISOString(), "Europe/Madrid");
// → '{:due :now :slot "2026-11-27T08:00:00Z"}'
```

- `run(action, input, timeoutMs)` runs on a worker thread and resolves to the
  outcome as EDN. It never rejects: a mistake in the action is a `:failed`
  outcome. `input` is a map of `:request`, `:ctx`, `:granted` and `:answers`.
- `due(action, lastRun, now, localZone)` says whether the action is due, as
  EDN. Times are RFC 3339; `lastRun` and `localZone` may be `null`. It throws
  when the action or a time can't be read.

Values cross as EDN text, the same text a run record holds. Map keys come out
in canonical order.

Workspace's apps load one native library for both `.table` formulas and
actions. This add-on is the Linux build of the actions half until the two are
packaged together.
