# workspace-actions

The engine for [Workspace actions](../../docs/actions/README.md),
`workspace-action-v1`, in Rust.

- **`action`** reads an action from its EDN and runs it. An action only
  asks: every `env/…` call is a request the app performs, so the engine
  has no network, files or clock of its own. A run that reaches a request
  without an answer stops and returns it. The app performs it and runs the
  action again with every answer so far, and those answers are the run
  record.
- **`trigger`** reads `:on`, including `[:at …]` (RFC 9557) and `[:cron …]`
  (a cron map or string, with seconds, milliseconds and a time zone).
- **`window`** decides whether a run is due, one per window across a
  workspace's devices.

It builds on table-file-format's EDN reader and printer (`workspace-edn`),
pinned to a commit. That dependency runs this way only: the `.table`
format never depends on actions.

## Running a run

```rust
let outcome = run(&action, &input, Limits::default(), &mut || past_deadline());
```

The interrupt is the runner's timeout: the spec sets no maximum, so each
runner decides. `Limits` is the runner protecting itself, not part of the
spec: how much of the thread's stack a run may use (measured, so debug and
release builds are both safe), and the largest single value it may make.
Run on a thread with at least twice `stack_bytes`; the default suits a
512 KiB thread, iOS's smallest.

## Checks

```sh
cargo test
cargo run --release --example depth -- 256 512   # stack guard: 256 KiB used on a 512 KiB thread
```

Rust 1.90 or later (the EDN core needs it).
