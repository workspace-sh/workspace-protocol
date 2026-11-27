//! JSON and EDN, each as the other. A fetch's answer is JSON given to an
//! action as EDN, and `.table` and JSON Canvas keep their content as JSON.

use serde_json::Value as J;
use workspace_edn::{print, Value as V};

/// Whether `k` can be written as a keyword, so `(:lat r)` works. A name that
/// can't (`"unit price"`) stays a string, read with `(get r "unit price")`.
pub fn keyword_ok(k: &str) -> bool {
    let mut chars = k.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    let rest_ok = |c: char| c.is_ascii_alphanumeric() || "*+!-_?<>=.".contains(c);
    (first.is_ascii_alphabetic() || "*+!-_?<>=".contains(first))
        && chars.all(rest_ok)
        && !(first == '-' && k[1..].starts_with(|c: char| c.is_ascii_digit()))
}

/// JSON as EDN. An object's key becomes a keyword when it can be one.
pub fn from_json(j: &J) -> V {
    match j {
        J::Null => V::Nil,
        J::Bool(b) => V::Bool(*b),
        J::Number(n) => match (n.as_i64(), n.as_f64()) {
            (Some(i), _) => V::Int(i),
            (None, _) if n.is_u64() => V::BigInt(n.to_string()),
            (None, Some(f)) => V::Float(f),
            _ => V::BigInt(n.to_string()),
        },
        J::String(s) => V::Str(s.clone()),
        J::Array(a) => V::Vector(a.iter().map(from_json).collect()),
        J::Object(o) => V::Map(
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

/// EDN as JSON. Keywords and symbols become their names, sets and lists
/// arrays, and a map key that isn't a keyword or a string its EDN text.
pub fn to_json(v: &V) -> J {
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
                        other => print(other),
                    };
                    (key, to_json(v))
                })
                .collect(),
        ),
        V::Tagged(_, inner) => to_json(inner),
    }
}

/// JSON text as an EDN value.
pub fn read_json(text: &str) -> Result<V, String> {
    serde_json::from_str::<J>(text)
        .map(|j| from_json(&j))
        .map_err(|e| format!("not JSON: {e}"))
}
