# workspace-actions-http

How a Workspace action's fetch goes on the wire
([Fetching](../../docs/actions/http.md)): one HTTP client and one set of
rules for every platform that can open a socket.

- **The rules** (`perform_with`): how often a host may be asked, which
  redirects are followed, how large an answer may be, and what each failure
  is called. Tested without a network (`tests/rules.rs`).
- **The wire** (`Wire`): one request out, one response back. `Client` is
  [`ureq`](https://crates.io/crates/ureq) over
  [`rustls`](https://crates.io/crates/rustls). A platform that can't open a
  socket puts its own wire under the same rules.

`call` is the engine's one call (`workspace_actions::api`) with `http`
added, so the bindings are built on this crate and carry no HTTP of their
own.

```sh
cargo test
cargo run --example fetch -- GET https://example.com/
```
