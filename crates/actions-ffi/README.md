# workspace-actions-ffi

The actions engine (`crates/actions`) behind a C interface, for every app
that isn't written in Rust or JavaScript: Swift on iOS and macOS, C and GTK,
Kotlin through JNI, Windows.

```c
char *out = workspace_actions_call("plan", "{\"format\":\"markdown\",…}", 0);
/* out is JSON */
workspace_actions_free(out);
```

There are two functions, in [`include/workspace_actions.h`](./include/workspace_actions.h):
one call that takes an operation's name and JSON text and returns JSON text,
and the one that frees what it returned. The operations are the engine's own
(`crates/actions/src/api.rs`), so a new platform gets every behaviour by
binding these two.

[`swift/WorkspaceActions.swift`](./swift/WorkspaceActions.swift) wraps them
for Swift: `call`, `callWithin` (off the calling thread, with a timeout) and
`runToEnd`, which runs an action and hands each request to the app to perform.

```sh
cargo build --release   # target/release/libworkspace_actions_ffi.{a,so,dylib}
cargo test              # builds c-test/main.c against the library and runs it
```

The Rust and C sides are tested on Linux. The Swift file hasn't been
compiled yet: it needs an Apple toolchain.

Workspace's apps link one native library for both `.table` formulas and
actions; this crate is also a Rust library so that build can include it.
