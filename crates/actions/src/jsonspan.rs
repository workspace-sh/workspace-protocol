//! Where things are in JSON text, so one value can be changed and every
//! other byte of the file left as it was: its order, its spacing, its
//! numbers exactly as written. A canvas or a row is somebody's file, and an
//! action changes only the value it keeps.

/// A member of an object: its key, and where its key and value are.
#[derive(Debug, Clone, PartialEq)]
pub struct Member {
    pub key: String,
    pub key_start: usize,
    pub value: (usize, usize),
}

fn skip_ws(b: &[u8], mut i: usize) -> usize {
    while b
        .get(i)
        .is_some_and(|c| matches!(c, b' ' | b'\t' | b'\n' | b'\r'))
    {
        i += 1;
    }
    i
}

/// The end of the string that opens at `i`.
fn skip_string(b: &[u8], i: usize) -> Option<usize> {
    let mut j = i + 1;
    loop {
        match b.get(j)? {
            b'"' => return Some(j + 1),
            b'\\' => j += 2,
            _ => j += 1,
        }
    }
}

/// The end of the value that starts at `i`.
pub fn skip_value(text: &str, i: usize) -> Option<usize> {
    let b = text.as_bytes();
    match b.get(i)? {
        b'"' => skip_string(b, i),
        b'{' => members(text, i).map(|(_, end)| end),
        b'[' => items(text, i).map(|(_, end)| end),
        _ => {
            let mut j = i;
            while b
                .get(j)
                .is_some_and(|c| !matches!(c, b',' | b'}' | b']' | b' ' | b'\t' | b'\n' | b'\r'))
            {
                j += 1;
            }
            (j > i).then_some(j)
        }
    }
}

/// The members of the object that opens at `start`, and where it ends.
pub fn members(text: &str, start: usize) -> Option<(Vec<Member>, usize)> {
    let b = text.as_bytes();
    if b.get(start) != Some(&b'{') {
        return None;
    }
    let mut out = Vec::new();
    let mut i = skip_ws(b, start + 1);
    if b.get(i) == Some(&b'}') {
        return Some((out, i + 1));
    }
    loop {
        let key_start = i;
        let key_end = skip_string(b, i).filter(|_| b.get(i) == Some(&b'"'))?;
        let key: String = serde_json::from_str(&text[key_start..key_end]).ok()?;
        i = skip_ws(b, key_end);
        if b.get(i) != Some(&b':') {
            return None;
        }
        let value_start = skip_ws(b, i + 1);
        let value_end = skip_value(text, value_start)?;
        out.push(Member {
            key,
            key_start,
            value: (value_start, value_end),
        });
        i = skip_ws(b, value_end);
        match b.get(i)? {
            b',' => i = skip_ws(b, i + 1),
            b'}' => return Some((out, i + 1)),
            _ => return None,
        }
    }
}

/// The items of the array that opens at `start`, and where it ends.
pub fn items(text: &str, start: usize) -> Option<(Vec<(usize, usize)>, usize)> {
    let b = text.as_bytes();
    if b.get(start) != Some(&b'[') {
        return None;
    }
    let mut out = Vec::new();
    let mut i = skip_ws(b, start + 1);
    if b.get(i) == Some(&b']') {
        return Some((out, i + 1));
    }
    loop {
        let end = skip_value(text, i)?;
        out.push((i, end));
        i = skip_ws(b, end);
        match b.get(i)? {
            b',' => i = skip_ws(b, i + 1),
            b']' => return Some((out, i + 1)),
            _ => return None,
        }
    }
}

/// The object at `start..end` of `text` with `key` set to `json`: replaced
/// where it is, or added after the last member, spaced as that one is.
/// Returns the edit as (start, end, replacement) against `text`.
pub fn set_member(
    text: &str,
    start: usize,
    key: &str,
    json: &str,
) -> Option<(usize, usize, String)> {
    let (all, end) = members(text, start)?;
    if let Some(m) = all.iter().find(|m| m.key == key) {
        return Some((m.value.0, m.value.1, json.to_string()));
    }
    let key_json = serde_json::to_string(key).ok()?;
    let Some(last) = all.last() else {
        return Some((start, end, format!("{{{key_json}:{json}}}")));
    };
    // What separates the last member from the one before it (or from `{`),
    // and its key from its value: the new member is written the same way.
    let before = text[..last.key_start].rfind([',', '{'])? + 1;
    let lead = &text[before..last.key_start];
    let key_end = last.key_start + text[last.key_start..].find(':')? + 1;
    let gap = &text[key_end..last.value.0];
    Some((
        last.value.1,
        last.value.1,
        format!(",{lead}{key_json}:{gap}{json}"),
    ))
}

/// Apply edits made against the same text, which mustn't overlap. Two
/// additions at the same point stay in the order they were given.
pub fn apply_edits(text: &str, edits: Vec<(usize, usize, String)>) -> String {
    let mut edits: Vec<_> = edits.into_iter().enumerate().collect();
    edits.sort_by_key(|(n, e)| std::cmp::Reverse((e.0, e.1, *n)));
    let mut out = text.to_string();
    for (_, (start, end, with)) in edits {
        out.replace_range(start..end, &with);
    }
    out
}
