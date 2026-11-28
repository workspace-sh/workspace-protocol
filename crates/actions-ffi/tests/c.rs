//! Builds `c-test/main.c` against the static library and runs it, so the
//! header, the symbols and the calling convention are checked by a real C
//! caller. Skipped, with a note, where there's no C compiler.

use std::path::PathBuf;
use std::process::Command;

#[test]
fn a_c_program_calls_the_engine() {
    let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let lib = here.join("target").join(if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    });
    let out = lib.join("c-test");
    let cc = std::env::var("CC").unwrap_or_else(|_| "cc".into());
    let built = Command::new(&cc)
        .arg(here.join("c-test/main.c"))
        .arg("-I")
        .arg(here.join("include"))
        .arg(lib.join("libworkspace_actions_ffi.a"))
        .args(["-lpthread", "-ldl", "-lm", "-o"])
        .arg(&out)
        .status();
    let Ok(status) = built else {
        eprintln!("no C compiler ({cc}); the C test didn't run");
        return;
    };
    assert!(status.success(), "the C test didn't build");
    let ran = Command::new(&out).output().expect("the C test runs");
    assert!(
        ran.status.success(),
        "{}",
        String::from_utf8_lossy(&ran.stderr)
    );
}
