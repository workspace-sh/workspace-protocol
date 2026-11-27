//! The rules every wire is held to, checked with a wire that isn't a network.

use std::cell::RefCell;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value as J};
use workspace_actions_http::{perform_with, Exchange, Failure, Pace, Reply, Wire, BURST, SPACING};

/// Answers from a script, and remembers what it was sent.
struct Script {
    replies: RefCell<Vec<Result<Reply, Failure>>>,
    sent: RefCell<Vec<Exchange>>,
}

impl Script {
    fn new(mut replies: Vec<Result<Reply, Failure>>) -> Self {
        replies.reverse();
        Script {
            replies: RefCell::new(replies),
            sent: RefCell::new(Vec::new()),
        }
    }
}

impl Wire for Script {
    fn send(&self, x: &Exchange) -> Result<Reply, Failure> {
        self.sent.borrow_mut().push(x.clone());
        self.replies
            .borrow_mut()
            .pop()
            .expect("no more replies in the script")
    }
}

fn ok(body: &str) -> Result<Reply, Failure> {
    Ok(Reply {
        status: 200,
        location: None,
        body: body.into(),
    })
}

fn to(location: &str) -> Result<Reply, Failure> {
    Ok(Reply {
        status: 302,
        location: Some(location.into()),
        body: String::new(),
    })
}

fn get(url: &str, redirect_hosts: &[&str]) -> J {
    json!({ "method": "GET", "url": url, "headers": [["accept", "application/json"]], "body": null,
            "timeoutMs": 10000, "maxBytes": 1000, "maxRedirects": 5, "redirectHosts": redirect_hosts })
}

fn run(wire: &Script, description: &J) -> J {
    perform_with(wire, description, &Mutex::new(Pace::default()), &mut |_| {})
}

#[test]
fn what_the_engine_described_is_what_is_sent() {
    let wire = Script::new(vec![Ok(Reply {
        status: 201,
        location: None,
        body: "{\"id\":7}".into(),
    })]);
    let out = run(
        &wire,
        &json!({ "method": "POST", "url": "https://api.example/items?dry=true",
        "headers": [["content-type", "application/json"], ["x-trace", "abc"]], "body": "{\"name\":\"Dune\"}",
        "timeoutMs": 4000, "maxBytes": 1000, "maxRedirects": 0, "redirectHosts": [] }),
    );
    assert_eq!(out, json!({ "status": 201, "body": "{\"id\":7}" }));
    let sent = wire.sent.borrow();
    assert_eq!(sent[0].method, "POST");
    assert_eq!(sent[0].url, "https://api.example/items?dry=true");
    assert_eq!(
        sent[0].headers,
        [
            ("content-type".to_string(), "application/json".to_string()),
            ("x-trace".to_string(), "abc".to_string())
        ]
    );
    assert_eq!(sent[0].body.as_deref(), Some("{\"name\":\"Dune\"}"));
    assert_eq!(sent[0].max_bytes, 1000);
    assert!(sent[0].timeout <= Duration::from_millis(4000));
}

#[test]
fn a_redirect_is_followed_only_where_the_action_may_fetch() {
    let wire = Script::new(vec![to("/moved"), to("https://cdn.example/x"), ok("done")]);
    let out = run(
        &wire,
        &get("https://a.example/x", &["a.example", "cdn.example"]),
    );
    assert_eq!(out["body"], "done");
    let urls: Vec<String> = wire.sent.borrow().iter().map(|x| x.url.clone()).collect();
    assert_eq!(
        urls,
        [
            "https://a.example/x",
            "https://a.example/moved",
            "https://cdn.example/x"
        ]
    );

    let wire = Script::new(vec![to("https://elsewhere.example/")]);
    let out = run(&wire, &get("https://a.example/x", &["a.example"]));
    assert_eq!(out["failed"], "denied");
    assert_eq!(
        out["message"],
        "a.example redirected to elsewhere.example, which the action may not fetch from"
    );
    assert_eq!(wire.sent.borrow().len(), 1, "nothing was sent elsewhere");

    let wire = Script::new(vec![to("http://a.example/plain")]);
    assert_eq!(
        run(&wire, &get("https://a.example/x", &["a.example"]))["failed"],
        "error"
    );
}

#[test]
fn redirects_end() {
    let wire = Script::new((0..7).map(|_| to("/again")).collect());
    let out = run(&wire, &get("https://a.example/x", &[]));
    assert_eq!(out["failed"], "error");
    assert_eq!(
        wire.sent.borrow().len(),
        6,
        "the first request and five redirects"
    );
}

#[test]
fn a_request_that_sends_follows_no_redirect() {
    let wire = Script::new(vec![to("/elsewhere")]);
    let out = run(
        &wire,
        &json!({ "method": "POST", "url": "https://a.example/x", "headers": [], "body": "x",
        "timeoutMs": 1000, "maxBytes": 10, "maxRedirects": 0, "redirectHosts": [] }),
    );
    assert_eq!(out["failed"], "error");
    assert_eq!(wire.sent.borrow().len(), 1);
}

#[test]
fn each_failure_has_its_name() {
    for (failure, reason) in [
        (Failure::Offline, "offline"),
        (Failure::Timeout, "timeout"),
        (Failure::TooLarge, "error"),
        (Failure::Other("a bad certificate".into()), "error"),
    ] {
        let wire = Script::new(vec![Err(failure)]);
        assert_eq!(
            run(&wire, &get("https://a.example/x", &[]))["failed"],
            reason
        );
    }
    let wire = Script::new(vec![]);
    assert_eq!(
        run(&wire, &get("http://a.example/x", &[]))["failed"],
        "error",
        "never anything but https"
    );
    assert!(run(
        &wire,
        &json!({ "method": "TRACE", "url": "https://a.example/" })
    )["error"]
        .is_string());
}

#[test]
fn a_host_is_asked_in_a_burst_and_then_once_a_second() {
    let mut pace = Pace::default();
    let now = Instant::now();
    for _ in 0..BURST as usize {
        assert_eq!(pace.take("a.example", now), Duration::ZERO);
    }
    assert_eq!(pace.take("a.example", now), SPACING);
    assert_eq!(
        pace.take("a.example", now),
        SPACING * 2,
        "each one queues behind the last"
    );
    assert_eq!(
        pace.take("b.example", now),
        Duration::ZERO,
        "another host has its own turn"
    );
    // Ten seconds later the first host's bucket has refilled, and no further.
    let later = now + Duration::from_secs(60);
    for _ in 0..BURST as usize {
        assert_eq!(pace.take("a.example", later), Duration::ZERO);
    }
    assert_eq!(pace.take("a.example", later), SPACING);
}

#[test]
fn a_request_that_would_wait_past_its_timeout_isnt_sent() {
    let pace = Mutex::new(Pace::default());
    let mut waited = Vec::new();
    let mut description = get("https://a.example/x", &[]);
    description["timeoutMs"] = json!(1500);
    let mut outcomes = Vec::new();
    for _ in 0..8 {
        let wire = Script::new(vec![ok("x")]);
        let out = perform_with(&wire, &description, &pace, &mut |d| waited.push(d));
        outcomes.push(
            out.get("failed")
                .and_then(J::as_str)
                .unwrap_or("sent")
                .to_string(),
        );
    }
    // Five at once, the sixth after a second, and the rest would wait past 1.5 s.
    assert_eq!(
        outcomes,
        ["sent", "sent", "sent", "sent", "sent", "sent", "timeout", "timeout"]
    );
    assert_eq!(waited.len(), 1);
}
