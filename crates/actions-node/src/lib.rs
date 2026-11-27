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
use workspace_actions::{due as due_at, parse_action, run_text, Due};

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
