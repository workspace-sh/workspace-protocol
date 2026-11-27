//! Where Markdown, TextBundle and TextPack keep an action and what it made
//! (`docs/actions/in-files.md`):
//!
//! ```markdown
//! Dublin: <!--[kept geo/place {:q "Dublin"} 2026-11-25T09:00Z]-->53.3498, -6.2603<!--[/kept]-->
//!
//! <!--action
//! {:id :geo/place :on :open :fresh "P1D" …}
//! -->
//! ```
//!
//! A marker may leave out its time: that's a place an action hasn't run for
//! yet, as a person writes one. Markers and actions inside code (a fenced
//! block, or an inline span) are text about actions, not actions, and are
//! never read.

use workspace_edn::{print, read, Value};

use crate::action::parse_action;
use crate::place::{Defined, Doc, Place, Problem, Update};

const CLOSE: &str = "<!--[/kept]-->";

/// A place and where its whole marker, from `<!--[kept` to `<!--[/kept]-->`, is.
struct Marked {
    place: Place,
    /// The inputs exactly as written, so writing back never reformats them.
    inputs_src: String,
    start: usize,
    end: usize,
}

/// Every action and kept value in `text`.
pub fn read_doc(text: &str) -> Doc {
    let (doc, _) = scan(text);
    doc
}

/// `text` with each update's value written into its place. A place that has
/// changed since the run began (another action, other inputs, or gone) is
/// left as it is, and its key returned.
pub fn apply(text: &str, updates: &[Update]) -> (String, Vec<String>) {
    let (_, marked) = scan(text);
    let mut skipped = Vec::new();
    let mut edits: Vec<(usize, usize, String)> = Vec::new();
    for u in updates {
        let found = marked
            .iter()
            .find(|m| m.place.key == u.key)
            .filter(|m| m.place.action == u.action && print(&m.place.inputs) == print(&u.inputs));
        match found {
            Some(m) => edits.push((
                m.start,
                m.end,
                marker(
                    &m.place.action,
                    &m.inputs_src,
                    Some(&u.at),
                    &kept_text(&u.keep),
                ),
            )),
            None => skipped.push(u.key.clone()),
        }
    }
    edits.sort_by_key(|e| std::cmp::Reverse(e.0));
    let mut out = text.to_string();
    for (start, end, with) in edits {
        out.replace_range(start..end, &with);
    }
    (out, skipped)
}

/// A kept marker as it's written. `inputs` is EDN text, or empty for none.
pub fn marker(action: &str, inputs: &str, at: Option<&str>, value: &str) -> String {
    let mut open = format!("<!--[kept {action}");
    for part in [Some(inputs), at].into_iter().flatten() {
        if !part.is_empty() {
            open.push(' ');
            open.push_str(part);
        }
    }
    format!("{open}]-->{value}{CLOSE}")
}

/// An action as the block that holds it, with what could end the comment
/// escaped. Refused when the EDN has `-->`, `<!--` or `--!>` outside a
/// string, where it can't be escaped.
pub fn action_block(edn: &str) -> Result<String, String> {
    Ok(format!("<!--action\n{}\n-->", escape_comment(edn.trim())?))
}

/// A kept value as Markdown text: `plain_text`, with `&` and `<` written as
/// entities, so a value never opens a tag or a comment.
pub fn kept_text(v: &Value) -> String {
    plain_text(v).replace('&', "&amp;").replace('<', "&lt;")
}

/// A kept value as a person would write it. A string is itself, a number or
/// a boolean its digits or word, and a list of those its items joined by
/// ", " (the spec's `53.3498, -6.2603`). Anything else is its EDN.
pub fn plain_text(v: &Value) -> String {
    fn scalar(v: &Value) -> Option<String> {
        match v {
            Value::Str(s) => Some(s.clone()),
            Value::Nil => Some(String::new()),
            Value::Bool(_) | Value::Int(_) | Value::Float(_) => Some(print(v)),
            Value::BigInt(s) | Value::Decimal(s) => Some(s.clone()),
            _ => None,
        }
    }
    scalar(v).unwrap_or_else(|| match v {
        Value::Vector(items) | Value::List(items) => items
            .iter()
            .map(scalar)
            .collect::<Option<Vec<_>>>()
            .map_or_else(|| print(v), |parts| parts.join(", ")),
        _ => print(v),
    })
}

fn unentity(s: &str) -> String {
    s.replace("&lt;", "<").replace("&amp;", "&")
}

/// Write every `<` and `>` inside a string as `<` and `>`, so the
/// EDN can never end the comment it's in.
pub fn escape_comment(edn: &str) -> Result<String, String> {
    let mut out = String::with_capacity(edn.len());
    let mut in_string = false;
    let mut chars = edn.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        if in_string {
            match c {
                '"' => {
                    in_string = false;
                    out.push(c);
                }
                '\\' => {
                    out.push(c);
                    if let Some((_, next)) = chars.next() {
                        out.push(next);
                    }
                }
                '<' => out.push_str("\\u003c"),
                '>' => out.push_str("\\u003e"),
                _ => out.push(c),
            }
            continue;
        }
        for bad in ["-->", "<!--", "--!>"] {
            if edn[i..].starts_with(bad) {
                return Err(format!(
                    "an action in Markdown can't have {bad} outside a string: it would end the comment that holds it"
                ));
            }
        }
        if c == '"' {
            in_string = true;
        }
        out.push(c);
    }
    Ok(out)
}

/// Undo `escape_comment`: `<` and `>` inside a string are `<` and
/// `>`. A string's other escapes, and everything outside strings, are untouched.
pub fn unescape_comment(edn: &str) -> String {
    let mut out = String::with_capacity(edn.len());
    let mut in_string = false;
    let mut i = 0;
    while i < edn.len() {
        let c = edn[i..].chars().next().unwrap();
        let len = c.len_utf8();
        if !in_string {
            if c == '"' {
                in_string = true;
            } else if c == ';' {
                // A comment runs to the end of its line, quotes and all.
                let end = edn[i..].find('\n').map_or(edn.len(), |n| i + n);
                out.push_str(&edn[i..end]);
                i = end;
                continue;
            } else if c == '\\' {
                // A character literal (`\"`) never opens a string.
                out.push(c);
                if let Some(next) = edn[i + 1..].chars().next() {
                    out.push(next);
                    i += next.len_utf8();
                }
                i += 1;
                continue;
            }
            out.push(c);
            i += len;
            continue;
        }
        if c == '"' {
            in_string = false;
            out.push(c);
            i += 1;
        } else if c == '\\' {
            let code = edn.get(i + 1..i + 6).map(str::to_ascii_lowercase);
            match code.as_deref() {
                Some("u003c") => {
                    out.push('<');
                    i += 6;
                }
                Some("u003e") => {
                    out.push('>');
                    i += 6;
                }
                _ => {
                    out.push(c);
                    if let Some(next) = edn[i + 1..].chars().next() {
                        out.push(next);
                        i += next.len_utf8();
                    }
                    i += 1;
                }
            }
        } else {
            out.push(c);
            i += len;
        }
    }
    out
}

/// Whether `s` is a marker's time: RFC 3339, to the minute or finer, with `Z` or an offset.
pub fn is_time(s: &str) -> bool {
    let b = s.as_bytes();
    let digits =
        |r: std::ops::Range<usize>| b.get(r).is_some_and(|d| d.iter().all(u8::is_ascii_digit));
    if !(digits(0..4) && b.get(4) == Some(&b'-') && digits(5..7) && b.get(7) == Some(&b'-'))
        || !(digits(8..10) && b.get(10) == Some(&b'T') && digits(11..13))
        || !(b.get(13) == Some(&b':') && digits(14..16))
    {
        return false;
    }
    let mut i = 16;
    if b.get(i) == Some(&b':') && digits(i + 1..i + 3) {
        i += 3;
        if b.get(i) == Some(&b'.') {
            i += 1;
            let from = i;
            while b.get(i).is_some_and(u8::is_ascii_digit) {
                i += 1;
            }
            if i == from {
                return false;
            }
        }
    }
    match &b[i..] {
        b"Z" => true,
        [b'+' | b'-', rest @ ..] => {
            rest.len() == 5
                && rest[2] == b':'
                && rest[..2].iter().chain(&rest[3..]).all(u8::is_ascii_digit)
        }
        _ => false,
    }
}

/// A marker's time with seconds, as a timestamp reads it (`…T09:00Z` is `…T09:00:00Z`).
pub fn full_time(s: &str) -> String {
    if s.as_bytes().get(16) == Some(&b':') {
        s.to_string()
    } else {
        format!("{}:00{}", &s[..16], &s[16..])
    }
}

enum Comment<'a> {
    Action(&'a str),
    Open { id: &'a str, rest: &'a str },
    Close,
    Other,
}

fn classify(body: &str) -> Comment<'_> {
    if body == "[/kept]" {
        return Comment::Close;
    }
    if let Some(rest) = body.strip_prefix("action") {
        if rest.starts_with(char::is_whitespace) {
            return Comment::Action(rest);
        }
    }
    if let Some(inner) = body
        .strip_prefix("[kept ")
        .and_then(|b| b.strip_suffix(']'))
    {
        let inner = inner.trim();
        let (id, rest) = inner.split_once(char::is_whitespace).unwrap_or((inner, ""));
        if !id.is_empty() {
            return Comment::Open {
                id,
                rest: rest.trim(),
            };
        }
    }
    Comment::Other
}

/// A fence's character and length, if `line` opens or closes one.
fn fence(line: &str) -> Option<(char, usize)> {
    let indent = line.len() - line.trim_start_matches(' ').len();
    if indent > 3 {
        return None;
    }
    let rest = &line[indent..];
    let c = rest.chars().next().filter(|c| *c == '`' || *c == '~')?;
    let n = rest.chars().take_while(|x| *x == c).count();
    (n >= 3).then_some((c, n))
}

fn scan(text: &str) -> (Doc, Vec<Marked>) {
    let mut doc = Doc::default();
    let mut marked: Vec<Marked> = Vec::new();
    // An opening marker waiting for its close: where it starts, where its value starts, its parts.
    let mut open: Option<(usize, usize, &str, &str)> = None;
    let mut in_fence: Option<(char, usize)> = None;
    let mut i = 0;
    let mut line_start = true;
    while i < text.len() {
        if line_start {
            let end = text[i..].find('\n').map_or(text.len(), |n| i + n);
            let line = &text[i..end];
            match (in_fence, fence(line)) {
                (None, Some(f)) => {
                    in_fence = Some(f);
                    i = (end + 1).min(text.len());
                    continue;
                }
                (Some((c, n)), Some((c2, n2)))
                    if c == c2 && n2 >= n && line.trim().chars().all(|x| x == c) =>
                {
                    in_fence = None;
                    i = (end + 1).min(text.len());
                    continue;
                }
                (Some(_), _) => {
                    i = (end + 1).min(text.len());
                    continue;
                }
                (None, None) => {}
            }
        }
        let rest = &text[i..];
        let c = rest.chars().next().unwrap();
        line_start = c == '\n';
        if c == '`' {
            // An inline code span: a run of backticks, closed by the next run of the same length.
            let n = rest.chars().take_while(|x| *x == '`').count();
            let mut j = i + n;
            let mut closed = None;
            while let Some(k) = text[j..].find('`') {
                let at = j + k;
                let m = text[at..].chars().take_while(|x| *x == '`').count();
                if m == n {
                    closed = Some(at + m);
                    break;
                }
                j = at + m;
            }
            i = closed.unwrap_or(i + n);
            continue;
        }
        if rest.starts_with("<!--") {
            let Some(len) = rest[4..].find("-->") else {
                break; // An unterminated comment runs to the end.
            };
            let (start, end) = (i, i + 4 + len + 3);
            match classify(&text[i + 4..i + 4 + len]) {
                Comment::Action(src) => {
                    let edn = unescape_comment(src);
                    match parse_action(&edn) {
                        Ok(a) if doc.action(&a.id).is_some() => doc.problems.push(Problem {
                            about: a.id.clone(),
                            message: format!(
                                "this document defines {} twice; the first one is used",
                                a.id
                            ),
                        }),
                        Ok(a) => doc.actions.push(Defined {
                            id: a.id,
                            edn: edn.trim().to_string(),
                        }),
                        Err(e) => doc.problems.push(Problem {
                            about: edn.trim().chars().take(40).collect(),
                            message: e.to_string(),
                        }),
                    }
                }
                Comment::Open { id, rest } => {
                    if let Some((_, _, was, _)) = open {
                        doc.problems.push(Problem {
                            about: was.to_string(),
                            message: "this kept marker has no <!--[/kept]--> before the next one"
                                .into(),
                        });
                    }
                    open = Some((start, end, id, rest));
                }
                Comment::Close => {
                    if let Some((from, value_from, id, rest)) = open.take() {
                        let (inputs_src, at) = match rest.rsplit_once(char::is_whitespace) {
                            Some((before, last)) if is_time(last) => (before.trim(), Some(last)),
                            None if is_time(rest) => ("", Some(rest)),
                            _ => (rest, None),
                        };
                        let inputs = if inputs_src.is_empty() {
                            Ok(Value::Nil)
                        } else {
                            read(&unescape_comment(inputs_src))
                        };
                        match inputs {
                            Ok(inputs) => marked.push(Marked {
                                place: Place {
                                    key: format!("m:{}", marked.len()),
                                    action: id.to_string(),
                                    inputs,
                                    at: at.map(full_time),
                                    value: Value::Str(unentity(&text[value_from..start])),
                                    from: None,
                                },
                                inputs_src: inputs_src.to_string(),
                                start: from,
                                end,
                            }),
                            Err(e) => doc.problems.push(Problem {
                                about: id.to_string(),
                                message: format!("a kept marker's inputs can't be read: {e}"),
                            }),
                        }
                    }
                }
                Comment::Other => {}
            }
            i = end;
            continue;
        }
        i += c.len_utf8();
    }
    if let Some((_, _, id, _)) = open {
        doc.problems.push(Problem {
            about: id.to_string(),
            message: "this kept marker has no <!--[/kept]--> after it".into(),
        });
    }
    doc.places = marked.iter().map(|m| m.place.clone()).collect();
    (doc, marked)
}
