//! The engine as one call, for every binding: an operation's name and its
//! input as JSON text in, JSON text out. A binding for a new platform is
//! this one function, so Swift, GTK, Node, the web and a command line all
//! get the same behaviour from the same code.
//!
//! JSON carries the structure. An action's own values (a request, what it
//! keeps) cross as EDN text inside it, exactly as the engine printed them,
//! so nothing is lost converting to a platform's types and back. The app
//! passes those strings along and never has to write EDN itself.
//!
//! What stays with the app is only what a platform does better: performing a
//! request (the network, a file, the clock, its locale, the screen), and
//! remembering what a device has granted.

use jiff::Timestamp;
use serde_json::{json, Map, Value as J};
use workspace_edn::{print, read, Value};

use crate::action::{answer_of, parse_action, read_input, run, Limits, Needs, Outcome};
use crate::json::{from_json, read_json, to_json};
use crate::place::{Doc, Problem, Update};
use crate::plan::{plan, Event};
use crate::trigger::Trigger;
use crate::{canvas, markdown, table};

/// The most requests one run may make, unless the app says otherwise.
const MAX_REQUESTS: usize = 32;

/// Run `op` with `input`. `interrupt` is the runner's timeout, as `run` takes
/// it. Never panics on bad input: a mistake is `{"error": "…"}`.
pub fn call(op: &str, input: &str, interrupt: &mut dyn FnMut() -> bool) -> String {
    let result = serde_json::from_str::<J>(input)
        .map_err(|e| format!("the input isn't JSON: {e}"))
        .and_then(|input| dispatch(op, &input, interrupt));
    match result {
        Ok(v) => v.to_string(),
        Err(message) => json!({ "error": message }).to_string(),
    }
}

/// Every operation `call` knows.
pub const OPS: &[&str] = &[
    "describe",
    "read",
    "plan",
    "run",
    "answer",
    "apply",
    "record",
    "check",
    "block",
    "jsonToEdn",
    "ednToJson",
];

fn dispatch(op: &str, input: &J, interrupt: &mut dyn FnMut() -> bool) -> Result<J, String> {
    match op {
        "describe" => describe(text(input, "edn")?),
        "read" => Ok(doc_json(&load(input)?)),
        "plan" => plan_op(input),
        "run" => run_op(input, interrupt),
        "answer" => answer_op(input),
        "apply" => apply_op(input),
        "record" => Ok(json!({ "record": print(&record(input)?) })),
        "check" => check_op(input, interrupt),
        "block" => Ok(json!({ "text": markdown::action_block(text(input, "edn")?)? })),
        "jsonToEdn" => {
            Ok(json!({ "edn": print(&from_json(input.get("json").unwrap_or(&J::Null))) }))
        }
        "ednToJson" => Ok(json!({ "json": to_json(&edn(input, "edn")?) })),
        _ => Err(format!(
            "{op:?} isn't an operation; there are {}",
            OPS.join(", ")
        )),
    }
}

fn text<'a>(input: &'a J, key: &str) -> Result<&'a str, String> {
    input
        .get(key)
        .and_then(J::as_str)
        .ok_or_else(|| format!("the input needs {key:?}, as text"))
}

fn edn(input: &J, key: &str) -> Result<Value, String> {
    read(text(input, key)?).map_err(|e| format!("{key}: {e}"))
}

fn needs_json(n: &Needs) -> J {
    json!({ "fetch": n.fetch, "read": n.read, "locate": n.locate, "ask": n.ask })
}

fn needs_of(j: Option<&J>) -> Needs {
    let list = |key: &str| {
        j.and_then(|j| j.get(key))
            .and_then(J::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    };
    let flag = |key: &str| {
        j.and_then(|j| j.get(key))
            .and_then(J::as_bool)
            .unwrap_or(false)
    };
    Needs {
        fetch: list("fetch"),
        read: list("read"),
        locate: flag("locate"),
        ask: flag("ask"),
    }
}

fn describe(edn: &str) -> Result<J, String> {
    let a = parse_action(edn).map_err(|e| e.to_string())?;
    let (on, of) = match &a.on {
        Trigger::None => ("none", None),
        Trigger::Open => ("open", None),
        Trigger::Tap => ("tap", None),
        Trigger::Edit(f) => ("edit", Some(f.clone())),
        Trigger::Change(p) => ("change", Some(p.clone())),
        Trigger::At(t) => ("at", Some(t.to_string())),
        Trigger::Cron(..) => ("cron", None),
        Trigger::Unknown(_) => ("unknown", None),
    };
    Ok(json!({ "id": a.id, "on": on, "of": of, "fresh": a.fresh, "needs": needs_json(&a.needs) }))
}

// ----------------------------------------------------------------------------
// Documents
// ----------------------------------------------------------------------------

fn load(input: &J) -> Result<Doc, String> {
    match text(input, "format")? {
        "markdown" => Ok(markdown::read_doc(text(input, "text")?)),
        "canvas" => Ok(canvas::read_doc(text(input, "text")?)),
        "table" => Ok(table::read_doc(
            text(input, "schema")?,
            text(input, "rows")?,
        )),
        other => Err(format!(
            "{other:?} isn't a format that keeps actions; there are markdown, canvas and table"
        )),
    }
}

fn problems_json(problems: &[Problem]) -> J {
    problems
        .iter()
        .map(|p| json!({ "about": p.about, "message": p.message }))
        .collect()
}

fn doc_json(doc: &Doc) -> J {
    json!({
        "actions": doc.actions.iter().map(|a| json!({ "id": a.id, "edn": a.edn })).collect::<Vec<_>>(),
        "places": doc.places.iter().map(|p| json!({
            "key": p.key, "action": p.action, "inputs": print(&p.inputs), "at": p.at,
            "value": to_json(&p.value),
        })).collect::<Vec<_>>(),
        "problems": problems_json(&doc.problems),
    })
}

fn event_of(j: Option<&J>) -> Result<Event, String> {
    let bad = || {
        "the event is \"open\", \"tick\", {\"tap\": key}, {\"edit\": name, \"row\": id} or {\"change\": path}".to_string()
    };
    match j {
        Some(J::String(s)) if s == "open" => Ok(Event::Open),
        Some(J::String(s)) if s == "tick" => Ok(Event::Tick),
        Some(J::Object(o)) => {
            let s = |k: &str| o.get(k).and_then(J::as_str).map(str::to_string);
            if let Some(key) = s("tap") {
                Ok(Event::Tap(key))
            } else if let Some(name) = s("edit") {
                Ok(Event::Edit {
                    name,
                    row: s("row"),
                })
            } else if let Some(path) = s("change") {
                Ok(Event::Change(path))
            } else {
                Err(bad())
            }
        }
        _ => Err(bad()),
    }
}

fn time(input: &J, key: &str) -> Result<Timestamp, String> {
    let s = text(input, key)?;
    s.parse()
        .map_err(|e| format!("{key}: {s:?} isn't an RFC 3339 time: {e}"))
}

fn plan_op(input: &J) -> Result<J, String> {
    let doc = load(input)?;
    let event = event_of(input.get("event"))?;
    let now = time(input, "now")?;
    let zone = input.get("zone").and_then(J::as_str);
    let grants = input.get("grants");
    let base = input.get("ctx").map_or(Value::Nil, from_json);
    let p = plan(
        &doc,
        &event,
        now,
        zone,
        &|id| needs_of(grants.and_then(|g| g.get(id))),
        &base,
    );
    Ok(json!({
        "runs": p.runs.iter().map(|r| json!({
            "key": r.key, "action": r.action, "edn": r.edn,
            "inputs": print(&r.request),
            "input": print(&Value::Map(vec![
                (Value::Keyword("request".into()), r.request.clone()),
                (Value::Keyword("ctx".into()), r.ctx.clone()),
                (Value::Keyword("granted".into()), r.granted.to_value()),
            ])),
            "slot": r.slot.map(|s| s.to_string()),
        })).collect::<Vec<_>>(),
        "held": p.held.iter().map(|h| json!({
            "key": h.key, "action": h.action, "why": h.why, "until": h.until.map(|u| u.to_string()),
        })).collect::<Vec<_>>(),
        "ungranted": p.ungranted.iter().map(|u| {
            let mut j = needs_json(&u.missing);
            j["action"] = json!(u.action);
            j["keys"] = json!(u.keys);
            j
        }).collect::<Vec<_>>(),
        "problems": problems_json(&p.problems),
    }))
}

/// The moment a value was kept, as its record writes it: UTC, to the second.
fn marker_time(t: Timestamp) -> String {
    t.strftime("%Y-%m-%dT%H:%M:%SZ").to_string()
}

fn apply_op(input: &J) -> Result<J, String> {
    let mut updates = Vec::new();
    for r in input
        .get("results")
        .and_then(J::as_array)
        .into_iter()
        .flatten()
    {
        updates.push(Update {
            key: text(r, "key")?.to_string(),
            action: text(r, "action")?.to_string(),
            inputs: edn(r, "inputs")?,
            at: marker_time(time(r, "at")?),
            keep: edn(r, "keepEdn")?,
        });
    }
    match text(input, "format")? {
        "markdown" => {
            let (text, skipped) = markdown::apply(text(input, "text")?, &updates);
            Ok(json!({ "text": text, "skipped": skipped }))
        }
        "canvas" => {
            let (text, skipped) = canvas::apply(text(input, "text")?, &updates);
            Ok(json!({ "text": text, "skipped": skipped }))
        }
        "table" => {
            let (rows, skipped) =
                table::apply(text(input, "schema")?, text(input, "rows")?, &updates);
            Ok(json!({ "rows": rows, "skipped": skipped }))
        }
        other => Err(format!("{other:?} isn't a format that keeps actions")),
    }
}

// ----------------------------------------------------------------------------
// Runs
// ----------------------------------------------------------------------------

fn pairs(input: &J) -> Result<Vec<(String, String)>, String> {
    let mut out = Vec::new();
    for pair in input
        .get("answers")
        .and_then(J::as_array)
        .into_iter()
        .flatten()
    {
        match pair.as_array().map(Vec::as_slice) {
            Some([J::String(request), J::String(answer)]) => {
                out.push((request.clone(), answer.clone()))
            }
            _ => return Err("answers is a list of [requestEdn, answerEdn]".into()),
        }
    }
    Ok(out)
}

fn outcome_of(input: &J, interrupt: &mut dyn FnMut() -> bool) -> Result<(Outcome, Needs), String> {
    let action = parse_action(text(input, "edn")?).map_err(|e| e.to_string())?;
    let mut run_input = read_input(input.get("input").and_then(J::as_str).unwrap_or("{}"))?;
    let answers = pairs(input)?;
    for (request, answer) in &answers {
        let request = read(request).map_err(|e| format!("a request: {e}"))?;
        let answer = read(answer).map_err(|e| format!("an answer: {e}"))?;
        run_input
            .answers
            .push((print(&request), answer_of(&answer)?));
    }
    let max = input
        .get("maxRequests")
        .and_then(J::as_u64)
        .map_or(MAX_REQUESTS, |n| n as usize);
    let outcome = match run(&action, &run_input, Limits::default(), interrupt) {
        Outcome::Needs { asked, .. } if answers.len() >= max => Outcome::Failed {
            reason: "limit".into(),
            message: format!("it made more than {max} requests"),
            suggestions: vec![],
            asked,
        },
        other => other,
    };
    Ok((outcome, run_input.granted))
}

fn run_op(input: &J, interrupt: &mut dyn FnMut() -> bool) -> Result<J, String> {
    let (outcome, granted) = outcome_of(input, interrupt)?;
    let fetch_timeout = input
        .get("fetchTimeoutMs")
        .and_then(J::as_u64)
        .unwrap_or(FETCH_TIMEOUT_MS);
    let asked = |a: &[(Value, Value)]| {
        print(&Value::Vector(
            a.iter()
                .map(|(r, x)| Value::Vector(vec![r.clone(), x.clone()]))
                .collect(),
        ))
    };
    Ok(match &outcome {
        Outcome::Done {
            keep,
            show,
            asked: a,
        } => json!({
            "status": "done",
            "keepEdn": keep.as_ref().map(print),
            "showEdn": show.as_ref().map(print),
            "show": show.as_ref().map(markdown::plain_text),
            "asked": asked(a),
        }),
        Outcome::Needs { request, asked: a } => {
            let mut j = to_json(request);
            if let Some(href) = href(request) {
                j["http"] = http(request, &href, &granted, fetch_timeout);
                j["href"] = json!(href);
            }
            json!({ "status": "needs", "requestEdn": print(request), "request": j, "asked": asked(a) })
        }
        Outcome::Failed {
            reason,
            message,
            suggestions,
            asked: a,
        } => json!({
            "status": "failed", "reason": reason, "message": message, "suggestions": suggestions, "asked": asked(a),
        }),
    })
}

fn get<'a>(map: &'a Value, name: &str) -> Option<&'a Value> {
    let Value::Map(entries) = map else {
        return None;
    };
    entries
        .iter()
        .find(|(k, _)| matches!(k, Value::Keyword(k) if k == name))
        .map(|(_, v)| v)
}

/// A fetch's whole address, query and all, so every platform asks for the same one.
fn href(request: &Value) -> Option<String> {
    if !matches!(get(request, "op"), Some(Value::Keyword(k)) if k == "fetch") {
        return None;
    }
    let Some(Value::Str(url)) = get(request, "url") else {
        return None;
    };
    let mut out = url.clone();
    if let Some(Value::Map(query)) = get(request, "query") {
        for (k, v) in query {
            let name = match k {
                Value::Keyword(s) | Value::Str(s) => s.clone(),
                other => print(other),
            };
            let value = match v {
                Value::Str(s) | Value::Keyword(s) => s.clone(),
                Value::Nil => String::new(),
                other => print(other),
            };
            out.push(if out.contains('?') { '&' } else { '?' });
            out.push_str(&encode(&name));
            out.push('=');
            out.push_str(&encode(&value));
        }
    }
    Some(out)
}

/// How long one fetch may take, unless the app says otherwise.
const FETCH_TIMEOUT_MS: u64 = 10_000;
/// The most a response may hold. A larger one fails as `error`.
pub const MAX_RESPONSE_BYTES: u64 = 5 * 1024 * 1024;
/// How an action's requests name themselves to a server.
pub const USER_AGENT: &str = "workspace-actions/1";

/// A fetch exactly as it goes on the wire, so every platform sends the same
/// bytes whatever carries them (`docs/actions/http.md`):
///
/// - `method`, `url` (query included) and `headers`, lower-case, in order.
/// - `body`: the text to send, or null. An action's string is sent as it is
///   (`text/plain`); any other value is sent as JSON.
/// - `timeoutMs` for the whole exchange, and `maxBytes` of response.
/// - `redirectHosts`: the hosts a redirect may lead to, over https, at most
///   `maxRedirects` times. A request that isn't a GET or HEAD follows none.
///
/// The app may add `proxy` (`http://host:port`) before it's sent, from the
/// system's settings; the engine never sets it.
fn http(request: &Value, href: &str, granted: &Needs, timeout_ms: u64) -> J {
    let method = match get(request, "method") {
        Some(Value::Keyword(m)) => m.to_ascii_uppercase(),
        _ => "GET".into(),
    };
    let mut headers: Vec<(String, String)> = Vec::new();
    if let Some(Value::Map(given)) = get(request, "headers") {
        for (k, v) in given {
            if let (Value::Str(k), Value::Str(v)) = (k, v) {
                headers.push((k.clone(), v.clone()));
            }
        }
    }
    let has = |headers: &[(String, String)], name: &str| headers.iter().any(|(k, _)| k == name);
    let body = match get(request, "body") {
        None => None,
        Some(Value::Str(text)) => {
            if !has(&headers, "content-type") {
                headers.push(("content-type".into(), "text/plain; charset=utf-8".into()));
            }
            Some(text.clone())
        }
        Some(value) => {
            if !has(&headers, "content-type") {
                headers.push(("content-type".into(), "application/json".into()));
            }
            Some(to_json(value).to_string())
        }
    };
    if !has(&headers, "accept") {
        headers.push(("accept".into(), "application/json".into()));
    }
    headers.push(("user-agent".into(), USER_AGENT.into()));
    headers.sort();
    let reads = method == "GET" || method == "HEAD";
    let redirect_hosts: Vec<&String> = if reads {
        granted.fetch.iter().filter(|h| !h.contains(' ')).collect()
    } else {
        Vec::new()
    };
    json!({
        "method": method,
        "url": href,
        "headers": headers.iter().map(|(k, v)| json!([k, v])).collect::<Vec<_>>(),
        "body": body,
        "timeoutMs": timeout_ms,
        "maxBytes": MAX_RESPONSE_BYTES,
        "maxRedirects": if reads { 5 } else { 0 },
        "redirectHosts": redirect_hosts,
    })
}

/// Percent-encode a query's name or value (RFC 3986's unreserved characters stay).
fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// What the app got for a request, as the answer the action is given.
///
/// - `{"failed": "offline", "message": "…"}`: it couldn't be done.
/// - `{"status": 200, "body": "…"}`: a fetch. JSON is read; anything else is its text.
/// - `{"text": "…"}`: a file's text (a canvas is read as JSON), the time, a formatted value.
/// - `{"table": {"tables": [{"name": …, "schema": "…", "rows": ["…"]}]}}`: a `.table`.
/// - `{"value": …}`: any JSON value, such as a place or what someone chose.
fn answer_op(input: &J) -> Result<J, String> {
    let request = edn(input, "requestEdn")?;
    let failed = |reason: &str, message: String| {
        Value::Map(vec![
            (
                Value::Keyword("failed".into()),
                Value::Keyword(reason.into()),
            ),
            (Value::Keyword("message".into()), Value::Str(message)),
        ])
    };
    let value = |v: Value| Value::Map(vec![(Value::Keyword("value".into()), v)]);
    let answer = if let Some(reason) = input.get("failed").and_then(J::as_str) {
        if !["offline", "timeout", "denied", "error"].contains(&reason) {
            return Err(format!(
                "a request fails as offline, timeout, denied or error, not {reason:?}"
            ));
        }
        failed(
            reason,
            input
                .get("message")
                .and_then(J::as_str)
                .unwrap_or("")
                .to_string(),
        )
    } else if let Some(status) = input.get("status").and_then(J::as_u64) {
        let body = input.get("body").and_then(J::as_str).unwrap_or("");
        if (200..300).contains(&status) {
            if body.len() as u64 > MAX_RESPONSE_BYTES {
                failed(
                    "error",
                    format!(
                        "the answer was larger than {} MB",
                        MAX_RESPONSE_BYTES / 1024 / 1024
                    ),
                )
            } else if body.trim().is_empty() {
                value(Value::Nil)
            } else {
                value(read_json(body).unwrap_or_else(|_| Value::Str(body.to_string())))
            }
        } else {
            let host = get(&request, "url")
                .and_then(|u| {
                    if let Value::Str(u) = u {
                        crate::action::https_host(u)
                    } else {
                        None
                    }
                })
                .unwrap_or("the server");
            failed("error", format!("{host} answered {status}"))
        }
    } else if let Some(t) = input.get("table") {
        value(table_shape(t)?)
    } else if let Some(text) = input.get("text").and_then(J::as_str) {
        let path = match get(&request, "path") {
            Some(Value::Str(p)) => p.to_ascii_lowercase(),
            _ => String::new(),
        };
        if path.ends_with(".canvas") || path.ends_with(".json") {
            value(read_json(text)?)
        } else {
            value(Value::Str(text.to_string()))
        }
    } else if let Some(v) = input.get("value") {
        value(from_json(v))
    } else {
        return Err("an answer has failed, status and body, text, table, or value".into());
    };
    Ok(json!({ "answerEdn": print(&answer) }))
}

/// What `env/read` gives for a `.table` (`docs/actions/reference.md`,
/// Requests): `{:fields […] :rows […]}` for its first table, each row a map
/// from field name to value, and every table by name under `:tables`.
fn table_shape(t: &J) -> Result<Value, String> {
    let k = |s: &str| Value::Keyword(s.into());
    let mut tables = Vec::new();
    for table in t.get("tables").and_then(J::as_array).into_iter().flatten() {
        let name = text(table, "name")?;
        let schema: J = serde_json::from_str(text(table, "schema")?)
            .map_err(|e| format!("{name}'s schema: {e}"))?;
        let fields: Vec<Value> = schema
            .get("fields")
            .and_then(J::as_array)
            .into_iter()
            .flatten()
            .filter_map(|f| f.get("name").and_then(J::as_str))
            .map(|n| {
                if crate::json::keyword_ok(n) {
                    k(n)
                } else {
                    Value::Str(n.into())
                }
            })
            .collect();
        let mut rows = Vec::new();
        for file in table
            .get("rows")
            .and_then(J::as_array)
            .into_iter()
            .flatten()
        {
            for line in file
                .as_str()
                .unwrap_or("")
                .lines()
                .filter(|l| !l.trim().is_empty())
            {
                if let Ok(J::Object(mut row)) = serde_json::from_str::<J>(line) {
                    row.remove("x-kept");
                    rows.push(from_json(&J::Object(row)));
                }
            }
        }
        tables.push((
            Value::Str(name.to_string()),
            Value::Map(vec![
                (k("fields"), Value::Vector(fields)),
                (k("rows"), Value::Vector(rows)),
            ]),
        ));
    }
    let Some((_, Value::Map(first))) = tables.first().cloned() else {
        return Err("a .table has at least one table".into());
    };
    let mut out = first;
    out.push((k("tables"), Value::Map(tables)));
    Ok(Value::Map(out))
}

// ----------------------------------------------------------------------------
// Run records
// ----------------------------------------------------------------------------

/// A run's record (`docs/actions/model.md`): what it was given, what it
/// asked and was told, and how it came out. Enough to check the result
/// without performing anything again.
fn record(input: &J) -> Result<Value, String> {
    let k = |s: &str| Value::Keyword(s.into());
    let run_input =
        read(input.get("input").and_then(J::as_str).unwrap_or("{}")).map_err(|e| e.to_string())?;
    let outcome = input
        .get("outcome")
        .ok_or("the input needs the run's outcome")?;
    let mut m = vec![
        (k("v"), Value::Int(1)),
        (k("action"), k(text(input, "action")?)),
        (k("at"), Value::Str(marker_time(time(input, "at")?))),
        (
            k("request"),
            get(&run_input, "request").cloned().unwrap_or(Value::Nil),
        ),
        (
            k("ctx"),
            get(&run_input, "ctx").cloned().unwrap_or(Value::Nil),
        ),
        (
            k("granted"),
            get(&run_input, "granted").cloned().unwrap_or(Value::Nil),
        ),
        (k("asked"), edn(outcome, "asked")?),
    ];
    if let Some(key) = input.get("key").and_then(J::as_str) {
        m.push((k("place"), Value::Str(key.into())));
    }
    if let Some(slot) = input.get("slot").and_then(J::as_str) {
        m.push((k("slot"), Value::Str(slot.into())));
    }
    let mut result = Vec::new();
    match text(outcome, "status")? {
        "done" => {
            for (name, key) in [("keep", "keepEdn"), ("show", "showEdn")] {
                if outcome.get(key).is_some_and(J::is_string) {
                    result.push((k(name), edn(outcome, key)?));
                }
            }
        }
        "failed" => {
            result.push((k("failed"), k(text(outcome, "reason")?)));
            result.push((k("message"), Value::Str(text(outcome, "message")?.into())));
        }
        other => {
            return Err(format!(
                "a record is of a run that ended, not one that's {other}"
            ))
        }
    }
    m.push((k("result"), Value::Map(result)));
    Ok(Value::Map(m))
}

/// Run the action again from a record's own answers, and say whether it
/// comes out as the record says. Nothing is performed.
fn check_op(input: &J, interrupt: &mut dyn FnMut() -> bool) -> Result<J, String> {
    let rec = edn(input, "record")?;
    let part = |name: &str| get(&rec, name).cloned().unwrap_or(Value::Nil);
    let k = |s: &str| Value::Keyword(s.into());
    let run_input = print(&Value::Map(vec![
        (k("request"), part("request")),
        (k("ctx"), part("ctx")),
        (k("granted"), part("granted")),
        (k("answers"), part("asked")),
    ]));
    let action = parse_action(text(input, "edn")?).map_err(|e| e.to_string())?;
    let outcome = run(
        &action,
        &read_input(&run_input)?,
        Limits::default(),
        interrupt,
    );
    let got = match &outcome {
        Outcome::Done { keep, show, .. } => {
            let mut m = Vec::new();
            if let Some(v) = keep {
                m.push((k("keep"), v.clone()));
            }
            if let Some(v) = show {
                m.push((k("show"), v.clone()));
            }
            Value::Map(m)
        }
        Outcome::Failed {
            reason, message, ..
        } => Value::Map(vec![
            (k("failed"), k(reason)),
            (k("message"), Value::Str(message.clone())),
        ]),
        Outcome::Needs { request, .. } => {
            return Ok(
                json!({ "ok": false, "why": format!("the record has no answer for {}", print(request)) }),
            )
        }
    };
    let said = part("result");
    let ok = print(&got) == print(&said);
    let mut out = Map::new();
    out.insert("ok".into(), json!(ok));
    if !ok {
        out.insert(
            "why".into(),
            json!(format!(
                "it comes out as {}, and the record says {}",
                print(&got),
                print(&said)
            )),
        );
    }
    Ok(J::Object(out))
}
