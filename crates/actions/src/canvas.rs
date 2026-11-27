//! Where a JSON Canvas keeps an action and what it made
//! (`docs/actions/in-files.md`):
//!
//! ```json
//! { "nodes": [
//!     { "id": "total", "type": "text", "text": "Total: £19,263",
//!       "x-action": "canvas/total",
//!       "x-kept": { "action": "canvas/total", "at": "2026-11-25T09:00:00Z" } } ],
//!   "x-actions": { "canvas/total": "{:id :canvas/total :on [:change \"budget.table\"] …}" } }
//! ```
//!
//! The kept value is a text node's own `text`, which every canvas app shows.
//! `"x-action"` names an action in `"x-actions"`, or is the action's EDN
//! itself. Inputs, when an action takes any, are `"from"` in `"x-kept"`.
//! Writing a value changes that node's `text` and `x-kept` and no other byte.

use serde_json::Value as J;
use workspace_edn::{print, Value};

use crate::action::parse_action;
use crate::json::{from_json, to_json};
use crate::jsonspan::{apply_edits, items, members, set_member};
use crate::place::{Defined, Doc, Place, Problem, Update};

struct Node {
    place: Place,
    /// Where the node's object starts in the text.
    start: usize,
}

pub fn read_doc(text: &str) -> Doc {
    scan(text).0
}

/// `text` with each update's value written into its node. A node that has
/// changed since the run began is left as it is, and its key returned.
pub fn apply(text: &str, updates: &[Update]) -> (String, Vec<String>) {
    let (_, nodes) = scan(text);
    let mut skipped = Vec::new();
    let mut edits = Vec::new();
    for u in updates {
        let found = nodes
            .iter()
            .find(|n| n.place.key == u.key)
            .filter(|n| n.place.action == u.action && print(&n.place.inputs) == print(&u.inputs));
        let Some(node) = found else {
            skipped.push(u.key.clone());
            continue;
        };
        let mut kept = serde_json::Map::new();
        kept.insert("action".into(), J::String(u.action.clone()));
        kept.insert("at".into(), J::String(u.at.clone()));
        if u.inputs != Value::Nil {
            kept.insert("from".into(), to_json(&u.inputs));
        }
        let text_json = J::String(crate::markdown::plain_text(&u.keep));
        // Two edits to one object: the second is found in the text the first leaves.
        let one = set_member(text, node.start, "text", &text_json.to_string());
        let two = set_member(text, node.start, "x-kept", &J::Object(kept).to_string());
        match (one, two) {
            (Some(a), Some(b)) => {
                edits.push(a);
                edits.push(b);
            }
            _ => skipped.push(u.key.clone()),
        }
    }
    (apply_edits(text, edits), skipped)
}

fn problem(about: impl Into<String>, message: impl Into<String>) -> Problem {
    Problem {
        about: about.into(),
        message: message.into(),
    }
}

/// Read an action's EDN into `doc`, returning its id. `named` is the id it's
/// stored under, when it's stored by id.
pub(crate) fn define(doc: &mut Doc, edn: &str, named: Option<&str>) -> Option<String> {
    match parse_action(edn) {
        Ok(a) => {
            if named.is_some_and(|n| n != a.id) {
                doc.problems.push(problem(
                    named.unwrap(),
                    format!(
                        "this action is stored as {} and calls itself {}",
                        named.unwrap(),
                        a.id
                    ),
                ));
                return None;
            }
            if doc.action(&a.id).is_none() {
                doc.actions.push(Defined {
                    id: a.id.clone(),
                    edn: edn.trim().to_string(),
                });
            }
            Some(a.id)
        }
        Err(e) => {
            doc.problems.push(problem(
                named.map_or_else(|| edn.trim().chars().take(40).collect(), str::to_string),
                e.to_string(),
            ));
            None
        }
    }
}

/// The actions in `"x-actions"`, a map from id to EDN text.
pub(crate) fn define_all(doc: &mut Doc, actions: Option<&J>) {
    let Some(J::Object(map)) = actions else {
        return;
    };
    for (id, edn) in map {
        match edn {
            J::String(edn) => {
                define(doc, edn, Some(id));
            }
            _ => doc
                .problems
                .push(problem(id, "an action in x-actions is its EDN, as text")),
        }
    }
}

fn scan(text: &str) -> (Doc, Vec<Node>) {
    let mut doc = Doc::default();
    let mut nodes = Vec::new();
    let start = text.len() - text.trim_start().len();
    let Some((top, _)) = members(text, start) else {
        doc.problems.push(problem(
            "canvas",
            "this isn't a JSON Canvas: it isn't a JSON object",
        ));
        return (doc, nodes);
    };
    let value = |key: &str| top.iter().find(|m| m.key == key).map(|m| m.value);
    if let Some((a, b)) = value("x-actions") {
        define_all(
            &mut doc,
            serde_json::from_str::<J>(&text[a..b]).ok().as_ref(),
        );
    }
    let Some((list, _)) = value("nodes").and_then(|(a, _)| items(text, a)) else {
        return (doc, nodes);
    };
    for (a, b) in list {
        let Ok(J::Object(node)) = serde_json::from_str::<J>(&text[a..b]) else {
            continue;
        };
        let kept = node.get("x-kept").and_then(J::as_object);
        let named = match node.get("x-action") {
            Some(J::String(s)) if s.trim_start().starts_with('{') => define(&mut doc, s, None),
            Some(J::String(s)) => Some(s.clone()),
            Some(_) => None,
            None => kept
                .and_then(|k| k.get("action"))
                .and_then(J::as_str)
                .map(str::to_string),
        };
        let (Some(action), Some(id)) = (named, node.get("id").and_then(J::as_str)) else {
            continue;
        };
        if node.get("type").and_then(J::as_str) != Some("text") {
            doc.problems.push(problem(
                format!("n:{id}"),
                "only a text node can keep a value: its text is the value",
            ));
            continue;
        }
        nodes.push(Node {
            place: Place {
                key: format!("n:{id}"),
                action,
                inputs: kept
                    .and_then(|k| k.get("from"))
                    .map_or(Value::Nil, from_json),
                at: kept
                    .and_then(|k| k.get("at"))
                    .and_then(J::as_str)
                    .map(str::to_string),
                value: node.get("text").map_or(Value::Nil, from_json),
                from: None,
            },
            start: a,
        });
    }
    doc.places = nodes.iter().map(|n| n.place.clone()).collect();
    (doc, nodes)
}
