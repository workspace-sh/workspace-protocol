//! The native Node binding (N-API) of `workspace-actions`, for the Linux app
//! and the command line. It is the engine's one call and nothing more: an
//! operation's name and JSON text in, JSON text out
//! (`workspace_actions::api`), with `http` added: the engine's own client
//! (`workspace_actions_http`), so nothing here uses Node's.

use std::time::{Duration, Instant};

use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Run an operation now, on the calling thread. For everything that's quick:
/// reading a document, planning, answering, writing back.
#[napi]
pub fn call(op: String, input: String) -> String {
    workspace_actions_http::call(&op, &input, &mut || false)
}

pub struct CallTask {
    op: String,
    input: String,
    timeout: Duration,
}

impl Task for CallTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> Result<String> {
        let deadline = Instant::now() + self.timeout;
        Ok(workspace_actions_http::call(
            &self.op,
            &self.input,
            &mut || Instant::now() >= deadline,
        ))
    }

    fn resolve(&mut self, _env: Env, output: String) -> Result<String> {
        Ok(output)
    }
}

/// Run an operation on a worker thread, stopped after `timeout_ms`: for
/// `run` and `check`, which execute an action and can take as long as the
/// action does. It never rejects; a run that's stopped fails as `timeout`.
#[napi(ts_return_type = "Promise<string>")]
pub fn call_within(op: String, input: String, timeout_ms: u32) -> AsyncTask<CallTask> {
    AsyncTask::new(CallTask {
        op,
        input,
        timeout: Duration::from_millis(timeout_ms.into()),
    })
}
