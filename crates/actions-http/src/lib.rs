//! How an action's fetch goes on the wire (`docs/actions/http.md`).
//!
//! The engine says exactly what to send: the method, the address, the
//! headers, the body, how long to wait, how much to accept and where a
//! redirect may lead (`workspace_actions::api`, `run`'s `request.http`).
//! This crate sends it, the same way on every platform that can open a
//! socket: Linux, macOS, iOS, Android, Windows, a command line, a
//! Lighthouse.
//!
//! It has two layers:
//!
//! - **The rules** (`perform_with`): how often a host may be asked, which
//!   redirects are followed, how large an answer may be, and what each
//!   failure is called. They're the same whatever carries the bytes.
//! - **The wire** (`Wire`): one exchange, a request out and a response back.
//!   `Client` is the one built in, `ureq` over `rustls`. A platform that
//!   can't open a socket (a browser) puts its own under the same rules.
//!
//! `call` is the engine's one call with one more operation, `http`, so a
//! binding built on this crate needs no HTTP of its own.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{json, Value as J};
use ureq::http;

/// The engine's one call, plus `http`: perform a fetch as `run` described
/// it. `input` is that description (`request.http`); the result is what
/// `answer` takes: `{"status": …, "body": "…"}` or `{"failed": …, "message": "…"}`.
pub fn call(op: &str, input: &str, interrupt: &mut dyn FnMut() -> bool) -> String {
    if op != "http" {
        return workspace_actions::api::call(op, input, interrupt);
    }
    match serde_json::from_str::<J>(input) {
        Ok(description) => perform(&description).to_string(),
        Err(e) => json!({ "error": format!("the input isn't JSON: {e}") }).to_string(),
    }
}

// ----------------------------------------------------------------------------
// The wire
// ----------------------------------------------------------------------------

/// One request, as it's sent.
#[derive(Debug, Clone, PartialEq)]
pub struct Exchange {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
    pub timeout: Duration,
    /// The most of the response's body to read.
    pub max_bytes: u64,
    /// The proxy to send it through, as the app read it from the system's
    /// settings: `http://host:port`. None is the environment's, if it names
    /// one (`HTTPS_PROXY`, `ALL_PROXY`).
    pub proxy: Option<String>,
}

/// What came back from one exchange.
#[derive(Debug, Clone, PartialEq)]
pub struct Reply {
    pub status: u16,
    /// The `location` header, if there was one.
    pub location: Option<String>,
    pub body: String,
}

/// Why an exchange gave no reply.
#[derive(Debug, Clone, PartialEq)]
pub enum Failure {
    /// The host couldn't be reached at all.
    Offline,
    Timeout,
    /// The body was larger than `max_bytes`.
    TooLarge,
    Other(String),
}

/// What carries one exchange. It follows no redirects and enforces no rules:
/// those are `perform_with`'s, so they hold for every wire.
pub trait Wire {
    fn send(&self, exchange: &Exchange) -> Result<Reply, Failure>;
}

/// The wire built in: `ureq` over `rustls`, trusting the authorities the
/// device trusts. HTTP/1.1, https only.
pub struct Client;

impl Wire for Client {
    fn send(&self, x: &Exchange) -> Result<Reply, Failure> {
        let mut config = ureq::Agent::config_builder();
        if let Some(proxy) = &x.proxy {
            let proxy = ureq::Proxy::new(proxy)
                .map_err(|e| Failure::Other(format!("the proxy {proxy:?} can't be used: {e}")))?;
            config = config.proxy(Some(proxy));
        }
        let agent: ureq::Agent = config
            .timeout_global(Some(x.timeout))
            .max_redirects(0)
            .max_redirects_will_error(false)
            .http_status_as_error(false)
            .https_only(true)
            .tls_config(
                ureq::tls::TlsConfig::builder()
                    .provider(ureq::tls::TlsProvider::Rustls)
                    .root_certs(ureq::tls::RootCerts::PlatformVerifier)
                    .build(),
            )
            .build()
            .into();
        let mut request = http::Request::builder()
            .method(x.method.as_str())
            .uri(&x.url);
        for (name, value) in &x.headers {
            request = request.header(name, value);
        }
        let request = request
            .body(x.body.clone().unwrap_or_default())
            .map_err(|e| Failure::Other(format!("the request couldn't be made: {e}")))?;
        let failure = |e: ureq::Error| match e {
            ureq::Error::Timeout(_) => Failure::Timeout,
            // A certificate that can't be trusted arrives as an I/O error. It
            // isn't the network being down, and mustn't read as if it were.
            ureq::Error::Io(e) if e.kind() == std::io::ErrorKind::InvalidData => {
                Failure::Other("its certificate couldn't be trusted, so nothing was sent".into())
            }
            ureq::Error::Io(_) | ureq::Error::HostNotFound | ureq::Error::ConnectionFailed => {
                Failure::Offline
            }
            ureq::Error::BodyExceedsLimit(_) => Failure::TooLarge,
            other => Failure::Other(other.to_string()),
        };
        let mut response = agent.run(request).map_err(failure)?;
        let location = response
            .headers()
            .get("location")
            .and_then(|l| l.to_str().ok())
            .map(str::to_string);
        let status = response.status().as_u16();
        let body = response
            .body_mut()
            .with_config()
            .limit(x.max_bytes)
            .read_to_string()
            .map_err(failure)?;
        Ok(Reply {
            status,
            location,
            body,
        })
    }
}

// ----------------------------------------------------------------------------
// The rules
// ----------------------------------------------------------------------------

/// How many requests one host may be sent at once before they're spaced out.
pub const BURST: f64 = 5.0;
/// After a burst, how long between requests to one host.
pub const SPACING: Duration = Duration::from_secs(1);

/// How often each host has been asked: a bucket of `BURST` requests that
/// refills one every `SPACING`. It protects the device and the host from a
/// document that asks the same place many times, whatever the action says.
#[derive(Default)]
pub struct Pace {
    /// By host: how many requests it has left, and when that was counted.
    hosts: HashMap<String, (f64, Instant)>,
}

impl Pace {
    /// Take one request to `host` at `now`: how long it must wait first.
    pub fn take(&mut self, host: &str, now: Instant) -> Duration {
        let (left, at) = self.hosts.get(host).copied().unwrap_or((BURST, now));
        let refilled = (left
            + now.saturating_duration_since(at).as_secs_f64() / SPACING.as_secs_f64())
        .min(BURST);
        // Going below zero is how requests already waiting are counted.
        let after = refilled - 1.0;
        self.hosts.insert(host.to_string(), (after, now));
        if after >= 0.0 {
            Duration::ZERO
        } else {
            SPACING.mul_f64(-after)
        }
    }

    /// Give back a request that never went out.
    fn give_back(&mut self, host: &str) {
        if let Some((left, _)) = self.hosts.get_mut(host) {
            *left += 1.0;
        }
    }
}

fn pace() -> &'static Mutex<Pace> {
    static PACE: OnceLock<Mutex<Pace>> = OnceLock::new();
    PACE.get_or_init(Mutex::default)
}

fn failed(reason: &str, message: impl Into<String>) -> J {
    json!({ "failed": reason, "message": message.into() })
}

fn host_of(url: &str) -> Option<&str> {
    let rest = url.strip_prefix("https://")?;
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let host = &rest[..end];
    (!host.is_empty() && !host.contains('@')).then_some(host)
}

/// Where a redirect leads, from the address that sent it.
fn follow(from: &str, location: &str) -> Option<String> {
    if location.starts_with("https://") {
        return Some(location.to_string());
    }
    if location.starts_with("//") {
        return Some(format!("https:{location}"));
    }
    if location.starts_with('/') {
        return Some(format!("https://{}{location}", host_of(from)?));
    }
    None
}

/// Send what `description` says with the built-in client.
pub fn perform(description: &J) -> J {
    perform_with(&Client, description, pace(), &mut std::thread::sleep)
}

/// Send what `description` says over `wire`, under the rules. `sleep` waits
/// out a host's spacing (a test passes one that doesn't).
pub fn perform_with(
    wire: &dyn Wire,
    description: &J,
    pace: &Mutex<Pace>,
    sleep: &mut dyn FnMut(Duration),
) -> J {
    let text = |key: &str| description.get(key).and_then(J::as_str);
    let number = |key: &str, otherwise: u64| {
        description
            .get(key)
            .and_then(J::as_u64)
            .unwrap_or(otherwise)
    };
    let (Some(method), Some(url)) = (text("method"), text("url")) else {
        return json!({ "error": "a fetch needs its method and url" });
    };
    if !workspace_actions::action::METHODS.contains(&method) {
        return json!({ "error": format!("{method:?} isn't a method a fetch can use") });
    }
    let Some(first_host) = host_of(url).map(str::to_string) else {
        return failed("error", format!("{url:?} isn't an https:// address"));
    };
    let timeout = Duration::from_millis(number("timeoutMs", 10_000));
    let max_bytes = number("maxBytes", workspace_actions::api::MAX_RESPONSE_BYTES);
    let may_reach: Vec<&str> = description
        .get("redirectHosts")
        .and_then(J::as_array)
        .into_iter()
        .flatten()
        .filter_map(J::as_str)
        .collect();
    let headers: Vec<(String, String)> = description
        .get("headers")
        .and_then(J::as_array)
        .into_iter()
        .flatten()
        .filter_map(|pair| {
            Some((
                pair.get(0)?.as_str()?.to_string(),
                pair.get(1)?.as_str()?.to_string(),
            ))
        })
        .collect();
    let started = Instant::now();
    let mut url = url.to_string();
    let mut hops = 0;
    loop {
        let host = host_of(&url).unwrap_or(&first_host).to_string();
        let left = timeout.saturating_sub(started.elapsed());
        let wait = {
            let mut pace = pace.lock().unwrap_or_else(|e| e.into_inner());
            let wait = pace.take(&host, Instant::now());
            if wait >= left {
                pace.give_back(&host);
            }
            wait
        };
        if wait >= left {
            return failed("timeout", format!("{host} is being asked too often; this request waited its turn until its time ran out"));
        }
        if !wait.is_zero() {
            sleep(wait);
        }
        let exchange = Exchange {
            method: method.to_string(),
            url: url.clone(),
            headers: headers.clone(),
            body: text("body").map(str::to_string),
            timeout: timeout
                .saturating_sub(started.elapsed())
                .max(Duration::from_millis(1)),
            max_bytes,
            proxy: text("proxy").filter(|p| !p.is_empty()).map(str::to_string),
        };
        let reply = match wire.send(&exchange) {
            Ok(r) => r,
            Err(Failure::Timeout) => {
                return failed("timeout", format!("{host} didn't answer in time"))
            }
            Err(Failure::Offline) => return failed("offline", format!("couldn't reach {host}")),
            Err(Failure::TooLarge) => {
                return failed(
                    "error",
                    format!(
                        "{host} answered with more than {} MB",
                        max_bytes / 1024 / 1024
                    ),
                )
            }
            Err(Failure::Other(why)) => return failed("error", format!("{host}: {why}")),
        };
        if !matches!(reply.status, 301 | 302 | 303 | 307 | 308) {
            return json!({ "status": reply.status, "body": reply.body });
        }
        let Some(next) = reply.location.as_deref().and_then(|l| follow(&url, l)) else {
            return failed(
                "error",
                format!("{host} redirected somewhere that isn't https"),
            );
        };
        let next_host = host_of(&next).unwrap_or("").to_string();
        hops += 1;
        if hops > number("maxRedirects", 0) {
            return failed(
                "error",
                format!("{host} redirected more than this request may follow"),
            );
        }
        if next_host != first_host && !may_reach.contains(&next_host.as_str()) {
            return failed(
                "denied",
                format!("{host} redirected to {next_host}, which the action may not fetch from"),
            );
        }
        url = next;
    }
}
