//! Where a `.table` keeps an action and what it made
//! (`docs/actions/in-files.md`). A table's `schema.json` holds its actions
//! by id, and a field names the one that fills it:
//!
//! ```json
//! "fields": [{ "name": "cover", "type": "string", "x-action": "books/cover" }],
//! "x-actions": { "books/cover": "{:id :books/cover :on [:edit \"isbn\"] …}" }
//! ```
//!
//! A row keeps the value as an ordinary cell, and what made it beside it:
//!
//! ```json
//! { "id": "r1", "isbn": "9780441013593", "cover": "https://…-M.jpg",
//!   "x-kept": { "cover": { "action": "books/cover", "at": "2026-11-25T09:00:00Z",
//!                          "from": { "isbn": "9780441013593" } } } }
//! ```
//!
//! An action's inputs are its row, without the cell it fills. `from` records
//! the cell an `[:edit …]` trigger watches, so a row edited anywhere, in any
//! app, is seen to have changed the next time the table opens.
//!
//! Rows are NDJSON; a rows file is read and written one at a time, and
//! writing a value changes that row's cell and `x-kept` and no other byte.

use serde_json::Value as J;
use workspace_edn::{print, Value};

use crate::action::parse_action;
use crate::canvas::define_all;
use crate::json::{from_json, to_json};
use crate::jsonspan::{apply_edits, set_member};
use crate::place::{Doc, Place, Problem, Update};
use crate::trigger::Trigger;

struct Cell {
    place: Place,
    /// Where the row's object starts in the rows text.
    start: usize,
    field: String,
}

/// The fields an action fills, as (field name, action id), and the actions.
fn schema(schema: &str) -> (Doc, Vec<(String, String)>) {
    let mut doc = Doc::default();
    let mut filled = Vec::new();
    let Ok(J::Object(s)) = serde_json::from_str::<J>(schema) else {
        doc.problems.push(Problem {
            about: "schema.json".into(),
            message: "the table's schema isn't a JSON object".into(),
        });
        return (doc, filled);
    };
    define_all(&mut doc, s.get("x-actions"));
    for f in s.get("fields").and_then(J::as_array).into_iter().flatten() {
        let (Some(name), Some(action)) = (
            f.get("name").and_then(J::as_str),
            f.get("x-action").and_then(J::as_str),
        ) else {
            continue;
        };
        if doc.action(action).is_none() {
            doc.problems.push(Problem {
                about: name.into(),
                message: format!(
                    "the field {name} names the action {action}, which x-actions doesn't have"
                ),
            });
            continue;
        }
        filled.push((name.to_string(), action.to_string()));
    }
    (doc, filled)
}

pub fn read_doc(schema_text: &str, rows: &str) -> Doc {
    scan(schema_text, rows).0
}

/// `rows` with each update's value written into its cell. A row that has
/// changed since the run began is left as it is, and its key returned.
pub fn apply(schema_text: &str, rows: &str, updates: &[Update]) -> (String, Vec<String>) {
    let (doc, cells) = scan(schema_text, rows);
    let mut skipped = Vec::new();
    let mut edits = Vec::new();
    // A row's `x-kept` as it will be after every update to that row.
    let mut kept_by_row: Vec<(usize, serde_json::Map<String, J>)> = Vec::new();
    for u in updates {
        let found = cells
            .iter()
            .find(|c| c.place.key == u.key)
            .filter(|c| c.place.action == u.action && print(&c.place.inputs) == print(&u.inputs));
        let Some(cell) = found else {
            skipped.push(u.key.clone());
            continue;
        };
        let mut entry = serde_json::Map::new();
        entry.insert("action".into(), J::String(u.action.clone()));
        entry.insert("at".into(), J::String(u.at.clone()));
        if let Some(from) = watched(&doc, &u.action, &u.inputs) {
            entry.insert("from".into(), to_json(&from));
        }
        let Some(edit) = set_member(rows, cell.start, &cell.field, &to_json(&u.keep).to_string())
        else {
            skipped.push(u.key.clone());
            continue;
        };
        edits.push(edit);
        let at = match kept_by_row
            .iter()
            .position(|(start, _)| *start == cell.start)
        {
            Some(i) => i,
            None => {
                let end = rows[cell.start..]
                    .find('\n')
                    .map_or(rows.len(), |n| cell.start + n);
                let was = serde_json::from_str::<J>(&rows[cell.start..end])
                    .ok()
                    .and_then(|row| row.get("x-kept").and_then(J::as_object).cloned())
                    .unwrap_or_default();
                kept_by_row.push((cell.start, was));
                kept_by_row.len() - 1
            }
        };
        kept_by_row[at]
            .1
            .insert(cell.field.clone(), J::Object(entry));
    }
    for (start, kept) in kept_by_row {
        if let Some(edit) = set_member(rows, start, "x-kept", &J::Object(kept).to_string()) {
            edits.push(edit);
        }
    }
    (apply_edits(rows, edits), skipped)
}

/// What a run's record says it was made from: the cell its `[:edit …]`
/// trigger watches, as it was.
fn watched(doc: &Doc, action: &str, inputs: &Value) -> Option<Value> {
    let a = parse_action(&doc.action(action)?.edn).ok()?;
    let Trigger::Edit(field) = a.on else {
        return None;
    };
    let Value::Map(entries) = inputs else {
        return None;
    };
    let found = entries
        .iter()
        .find(|(k, _)| matches!(k, Value::Keyword(k) | Value::Str(k) if *k == field))?;
    Some(Value::Map(vec![found.clone()]))
}

fn scan(schema_text: &str, rows: &str) -> (Doc, Vec<Cell>) {
    let (mut doc, filled) = schema(schema_text);
    let mut cells = Vec::new();
    if filled.is_empty() {
        return (doc, cells);
    }
    let mut offset = 0;
    for line in rows.split_inclusive('\n') {
        let start = offset + (line.len() - line.trim_start().len());
        offset += line.len();
        if line.trim().is_empty() {
            continue;
        }
        let Ok(J::Object(row)) = serde_json::from_str::<J>(line) else {
            continue;
        };
        let Some(id) = row.get("id").and_then(J::as_str) else {
            continue;
        };
        let kept = row.get("x-kept").and_then(J::as_object);
        for (field, action) in &filled {
            let mut inputs = row.clone();
            inputs.remove("x-kept");
            inputs.remove(field);
            let entry = kept.and_then(|k| k.get(field)).and_then(J::as_object);
            let inputs = from_json(&J::Object(inputs));
            cells.push(Cell {
                place: Place {
                    key: format!("r:{id}:{field}"),
                    action: action.clone(),
                    from: Some(
                        entry
                            .and_then(|e| e.get("from"))
                            .map_or(Value::Nil, from_json),
                    ),
                    at: entry
                        .and_then(|e| e.get("at"))
                        .and_then(J::as_str)
                        .map(str::to_string),
                    value: row.get(field).map_or(Value::Nil, from_json),
                    inputs,
                },
                start,
                field: field.clone(),
            });
        }
    }
    doc.places = cells.iter().map(|c| c.place.clone()).collect();
    (doc, cells)
}
