//! The C interface of `workspace-actions`: the engine's one call
//! (`workspace_actions::api`), an operation's name and JSON text in, JSON
//! text out. Swift, C, Kotlin through JNI and anything else that can call C
//! use the engine through these two functions.

use std::ffi::{c_char, CStr, CString};
use std::time::{Duration, Instant};

/// Run an operation. `op` and `input` are NUL-terminated UTF-8; `input` is
/// JSON. `timeout_ms` stops an operation that runs an action (`run`,
/// `check`) after that long, failing it as `timeout`; 0 is no timeout.
///
/// Returns NUL-terminated JSON that the caller frees with
/// `workspace_actions_free`. It never returns NULL and never unwinds: a
/// mistake in the input is `{"error": "…"}`. It keeps nothing between calls
/// and may be called from any thread.
///
/// # Safety
/// `op` and `input` are valid NUL-terminated strings, or NULL.
#[no_mangle]
pub unsafe extern "C" fn workspace_actions_call(
    op: *const c_char,
    input: *const c_char,
    timeout_ms: u32,
) -> *mut c_char {
    let text = |p: *const c_char| {
        if p.is_null() {
            return String::new();
        }
        // SAFETY: the caller's contract.
        unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned()
    };
    let (op, input) = (text(op), text(input));
    let deadline =
        (timeout_ms > 0).then(|| Instant::now() + Duration::from_millis(timeout_ms.into()));
    let out = workspace_actions_http::call(&op, &input, &mut || {
        deadline.is_some_and(|d| Instant::now() >= d)
    });
    // JSON text never holds a NUL; if it somehow did, say so rather than cut it short.
    CString::new(out)
        .unwrap_or_else(|_| CString::new(r#"{"error":"the result held a NUL"}"#).unwrap())
        .into_raw()
}

/// Free what `workspace_actions_call` returned. NULL is ignored.
///
/// # Safety
/// `text` came from `workspace_actions_call` and hasn't been freed.
#[no_mangle]
pub unsafe extern "C" fn workspace_actions_free(text: *mut c_char) {
    if !text.is_null() {
        // SAFETY: the caller's contract.
        drop(unsafe { CString::from_raw(text) });
    }
}
