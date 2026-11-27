//! The native Node binding (N-API) of `workspace-actions`, for the Linux app
//! and the CLI. Values cross as EDN text, the same text a run record holds,
//! so nothing is lost converting to JavaScript and back.
//!
//! `run` works on a libuv worker thread and resolves a promise, so a slow
//! action never blocks the event loop. The timeout is the runner's: when it
//! passes, the run stops and fails as `timeout`.

use std::time::{Duration, Instant};

use jiff::Timestamp;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use workspace_actions::{due as due_at, parse_action, run_text, Due, Trigger};

pub struct RunTask {
    action: String,
    input: String,
    timeout: Duration,
}

impl Task for RunTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> Result<String> {
        let deadline = Instant::now() + self.timeout;
        Ok(run_text(&self.action, &self.input, &mut || {
            Instant::now() >= deadline
        }))
    }

    fn resolve(&mut self, _env: Env, output: String) -> Result<String> {
        Ok(output)
    }
}

/// Run an action once. `action` is its EDN; `input` is an EDN map with
/// `:request`, `:ctx`, `:granted` and `:answers` (`[[request answer] …]`).
/// Resolves to the outcome as EDN: `{:status :done …}`, `{:status :needs
/// :request …}` or `{:status :failed :reason … :message …}`. It never
/// rejects: a mistake in the action or the input is a `:failed` outcome.
#[napi(ts_return_type = "Promise<string>")]
pub fn run(action: String, input: String, timeout_ms: u32) -> AsyncTask<RunTask> {
    AsyncTask::new(RunTask {
        action,
        input,
        timeout: Duration::from_millis(timeout_ms.into()),
    })
}

/// Whether an action is due now, as EDN: `{:due :now}` (with `:slot`, the
/// moment a clock run is for, which its run record carries) or `{:due :later
/// :why "…"}` (with `:until` when the next moment is known). Times are RFC
/// 3339 text; `last_run` is the latest run record's time or slot, if any;
/// `local_zone` is this member's IANA zone, for `:tz :local`. Throws when the
/// action can't be read or its schedule can't be worked out.
#[napi]
pub fn due(
    action: String,
    last_run: Option<String>,
    now: String,
    local_zone: Option<String>,
) -> Result<String> {
    let invalid = |m: String| Error::new(Status::InvalidArg, m);
    let a = parse_action(&action).map_err(|e| invalid(e.to_string()))?;
    let time = |s: &str| {
        s.parse::<Timestamp>()
            .map_err(|e| invalid(format!("{s:?} isn't an RFC 3339 time: {e}")))
    };
    let last_run = last_run.as_deref().map(time).transpose()?;
    let now = time(&now)?;
    let d = due_at(
        &a.on,
        a.fresh.as_deref(),
        last_run,
        now,
        local_zone.as_deref(),
    )
    .map_err(invalid)?;
    Ok(match d {
        Due::Now { slot: None } => "{:due :now}".into(),
        Due::Now { slot: Some(s) } => format!("{{:due :now :slot {}}}", edn_str(&s.to_string())),
        Due::Later { until, why } => {
            let until = until.map_or(String::new(), |u| {
                format!(" :until {}", edn_str(&u.to_string()))
            });
            format!("{{:due :later{until} :why {}}}", edn_str(why))
        }
    })
}

fn edn_str(s: &str) -> String {
    workspace_edn::print(&workspace_edn::Value::Str(s.into()))
}

/// JSON as EDN text, as a fetch's answer is given to an action. An object's
/// key becomes a keyword when it can be one (`"lat"` → `:lat`), so `(:lat r)`
/// works, and stays a string otherwise (`"unit price"`). Throws on bad JSON.
#[napi(js_name = "jsonToEdn")]
pub fn json_to_edn(json: String) -> Result<String> {
    let j: serde_json::Value = serde_json::from_str(&json)
        .map_err(|e| Error::new(Status::InvalidArg, format!("not JSON: {e}")))?;
    Ok(workspace_edn::print(&from_json(&j)))
}

/// EDN text as JSON, for the app to read a request or show a kept value.
/// Keywords and symbols become their names, sets and lists arrays, and a map
/// key that isn't a keyword or a string its EDN text. Throws on bad EDN.
#[napi(js_name = "ednToJson")]
pub fn edn_to_json(edn: String) -> Result<String> {
    let v = workspace_edn::read(&edn).map_err(|e| Error::new(Status::InvalidArg, e.to_string()))?;
    Ok(to_json(&v).to_string())
}

fn keyword_ok(k: &str) -> bool {
    let mut chars = k.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    let rest_ok = |c: char| c.is_ascii_alphanumeric() || "*+!-_?<>=.".contains(c);
    (first.is_ascii_alphabetic() || "*+!-_?<>=".contains(first))
        && chars.all(rest_ok)
        && !(first == '-' && k[1..].starts_with(|c: char| c.is_ascii_digit()))
}

fn from_json(j: &serde_json::Value) -> workspace_edn::Value {
    use workspace_edn::Value as V;
    match j {
        serde_json::Value::Null => V::Nil,
        serde_json::Value::Bool(b) => V::Bool(*b),
        serde_json::Value::Number(n) => match (n.as_i64(), n.as_f64()) {
            (Some(i), _) => V::Int(i),
            (None, _) if n.is_u64() => V::BigInt(n.to_string()),
            (None, Some(f)) => V::Float(f),
            _ => V::BigInt(n.to_string()),
        },
        serde_json::Value::String(s) => V::Str(s.clone()),
        serde_json::Value::Array(a) => V::Vector(a.iter().map(from_json).collect()),
        serde_json::Value::Object(o) => V::Map(
            o.iter()
                .map(|(k, v)| {
                    let key = if keyword_ok(k) {
                        V::Keyword(k.clone())
                    } else {
                        V::Str(k.clone())
                    };
                    (key, from_json(v))
                })
                .collect(),
        ),
    }
}

fn to_json(v: &workspace_edn::Value) -> serde_json::Value {
    use serde_json::Value as J;
    use workspace_edn::Value as V;
    match v {
        V::Nil => J::Null,
        V::Bool(b) => J::Bool(*b),
        V::Int(i) => J::from(*i),
        V::Float(f) => serde_json::Number::from_f64(*f).map_or(J::Null, J::Number),
        V::Str(s) | V::Symbol(s) | V::Keyword(s) | V::BigInt(s) | V::Decimal(s) => {
            J::String(s.clone())
        }
        V::Char(c) => J::String(c.to_string()),
        V::List(items) | V::Vector(items) | V::Set(items) => {
            J::Array(items.iter().map(to_json).collect())
        }
        V::Map(entries) => J::Object(
            entries
                .iter()
                .map(|(k, v)| {
                    let key = match k {
                        V::Str(s) | V::Keyword(s) => s.clone(),
                        other => workspace_edn::print(other),
                    };
                    (key, to_json(v))
                })
                .collect(),
        ),
        V::Tagged(_, inner) => to_json(inner),
    }
}

/// The value at `key` in an EDN map, as EDN text, or `null` when the map has
/// no such key. `key` is a keyword's name (`"request"` for `:request`). It
/// lets the app take a request or a kept value out of an outcome exactly as
/// the engine printed it. Throws when `edn` isn't a map.
#[napi]
pub fn get(edn: String, key: String) -> Result<Option<String>> {
    let v = workspace_edn::read(&edn).map_err(|e| Error::new(Status::InvalidArg, e.to_string()))?;
    let workspace_edn::Value::Map(entries) = v else {
        return Err(Error::new(Status::InvalidArg, "not an EDN map".to_string()));
    };
    Ok(entries.iter().find_map(|(k, v)| match k {
        workspace_edn::Value::Keyword(k) if *k == key => Some(workspace_edn::print(v)),
        _ => None,
    }))
}

/// What an action is, for the app to show and to decide what to grant.
#[napi(object)]
pub struct Described {
    pub id: String,
    /// What runs it: `"open"`, `"tap"`, `"edit"`, `"change"`, `"at"`, `"cron"`,
    /// `"none"`, or `"unknown"` for a trigger this version doesn't know.
    pub on: String,
    /// `:fresh`, an ISO 8601 duration, if it has one.
    pub fresh: Option<String>,
    /// The hosts it may fetch from.
    pub fetch: Vec<String>,
    /// The workspace paths it may read.
    pub read: Vec<String>,
    pub locate: bool,
    pub ask: bool,
}

/// Read an action without running it. Throws, with the reader's message,
/// when it can't be read.
#[napi]
pub fn describe(action: String) -> Result<Described> {
    let a = parse_action(&action).map_err(|e| Error::new(Status::InvalidArg, e.to_string()))?;
    let on = match a.on {
        Trigger::None => "none",
        Trigger::Open => "open",
        Trigger::Tap => "tap",
        Trigger::Edit(_) => "edit",
        Trigger::Change(_) => "change",
        Trigger::At(_) => "at",
        Trigger::Cron(..) => "cron",
        Trigger::Unknown(_) => "unknown",
    };
    Ok(Described {
        id: a.id,
        on: on.into(),
        fresh: a.fresh,
        fetch: a.needs.fetch,
        read: a.needs.read,
        locate: a.needs.locate,
        ask: a.needs.ask,
    })
}
