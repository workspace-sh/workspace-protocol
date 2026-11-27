//! Perform one fetch from the command line, as the engine would describe it:
//!
//!     cargo run --example fetch -- GET https://example.com/
//!
//! Prints what `answer` would be given.

use serde_json::json;

fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(method), Some(url)) = (args.next(), args.next()) else {
        eprintln!("usage: fetch METHOD https://address [body]");
        std::process::exit(2);
    };
    let host = url
        .trim_start_matches("https://")
        .split('/')
        .next()
        .unwrap_or("")
        .to_string();
    let reads = method == "GET" || method == "HEAD";
    let out = workspace_actions_http::perform(&json!({
        "method": method, "url": url,
        "headers": [["accept", "application/json"], ["user-agent", workspace_actions::api::USER_AGENT]],
        "body": args.next(), "timeoutMs": 10000,
        "maxBytes": workspace_actions::api::MAX_RESPONSE_BYTES,
        "maxRedirects": if reads { 5 } else { 0 }, "redirectHosts": [host],
    }));
    let mut text = out.to_string();
    if text.len() > 400 {
        text.truncate(text.char_indices().nth(400).map_or(text.len(), |(i, _)| i));
        text.push('…');
    }
    println!("{text}");
}
