# Fetching

How an action's `env/fetch` reaches the network. Decided 27 Nov 2026.

An action is meant to run the same on every device a workspace is on. If
each platform used its own HTTP library, each would differ a little: in
how it follows a redirect, encodes a body, times out, or how fast it
will hammer a server. So the engine carries one client, and the same
rules hold whatever carries the bytes.

## What an action can ask for

```clojure
(env/fetch "https://api.example.org/items" {:q "dune"})
(env/fetch "https://api.example.org/items" nil
           {:method :post :body {:title "Dune"} :headers {"x-trace" "abc"}})
```

| Part | Says |
| --- | --- |
| The address | `https://` only |
| The query | A map; its names are sent in sorted order |
| `:method` | `:get` (when left out), `:head`, `:post`, `:put`, `:patch`, `:delete` |
| `:body` | A string is sent as it is, as `text/plain`. Any other value is sent as JSON. A GET or HEAD has none |
| `:headers` | A map from name to text |

**Reading and sending are granted apart.** A host in `:needs :fetch`
lets an action read from it, with GET and HEAD. Sending needs the method
too: `[:post "api.example.org"]`. A device grants each separately, so
allowing an action to look something up never allows it to change
anything.

**An action can't say who it is.** `authorization`, `cookie`, `host`,
`user-agent`, `origin`, `referer` and the headers that control the
connection are refused. Who a request is from is the app's to say (see
[Credentials](./credentials.md)), never the action's.

## What is sent

The engine turns a request into its exact form on the wire, and that is
what every platform sends:

| | |
| --- | --- |
| Headers | Lower-case, in sorted order. `accept: application/json` unless the action gives one, `content-type` to match the body, and `user-agent: workspace-actions/1` |
| Time | 10 seconds for the whole exchange, unless the runner allows another |
| Size | An answer over 5 MB fails as `:error` |
| Redirects | A GET or HEAD follows up to 5, over https, and only to its own host or another the action may read from. Anything else fails: `:denied` for a host it may not reach. A request that sends follows none |
| Pace | One host is asked at most 5 times at once, then once a second, across every action on the device. A request waits its turn within its own time, and fails as `:timeout` if that runs out |

## What comes back

| | The action gets |
| --- | --- |
| 200–299 | The body, read as JSON; its text when it isn't JSON; `nil` when it's empty |
| Any other status | A failure, `:error`: "api.example.org answered 404" |
| No network, no such host | `:offline` |
| Too slow | `:timeout` |
| A certificate that can't be trusted | `:error`, and nothing is sent |

## The client

[`crates/actions-http`](../../crates/actions-http/) has two layers.

- **The rules**, above: pace, redirects, size, and what each failure is
  called. They're written once and tested without a network.
- **The wire** under them: one request out, one response back. The one
  built in is [`ureq`](https://crates.io/crates/ureq) over
  [`rustls`](https://crates.io/crates/rustls), HTTP/1.1. TLS is compiled
  in, so it behaves the same on every platform and needs nothing from
  the operating system. Which certificate authorities to trust is still
  the device's own list.

It runs wherever a program can open a socket: Linux, macOS, iOS,
Android, Windows, a command line, a Lighthouse. A browser can't, so a
web app puts the browser's `fetch` under the same rules as its wire.

**Proxies.** A device may send its traffic through a proxy. Where that
is in the environment (`HTTPS_PROXY`, `ALL_PROXY`), as on Linux and a
command line, the client follows it by itself. Where it is in the
system's settings or decided per address by a script, as on iOS and
macOS, the app asks the system which proxy that address takes and adds
it to the request as `proxy` (`http://host:port`). The same proxy
carries the request's redirects. A VPN needs nothing: it routes
underneath.

Not yet: HTTP/2, SOCKS proxies, a proxy that asks for a password, and a
response that isn't text.

Up: [Workspace actions](./README.md) · [All docs](../README.md)
