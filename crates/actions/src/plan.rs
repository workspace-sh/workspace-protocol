//! What runs now. Given a document's actions and places and something that
//! just happened, this decides which places run, which are held back and
//! why, and which wait for this device to grant what their action needs
//! (`docs/actions/reference.md`, Triggers; `docs/actions/running.md`).

use jiff::Timestamp;
use workspace_edn::Value;

use crate::action::{parse_action, Needs};
use crate::place::{Doc, Place, Problem};
use crate::trigger::Trigger;
use crate::window::{due, Due};

/// Something that happened, which may run actions.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    /// The document opened.
    Open,
    /// Time passed: only clocks are checked.
    Tick,
    /// Someone tapped a place's mark.
    Tap(String),
    /// A field, or a named piece of text, changed; in a table, in that row.
    Edit { name: String, row: Option<String> },
    /// Another file changed, by path relative to the document.
    Change(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Run {
    pub key: String,
    pub action: String,
    pub edn: String,
    pub request: Value,
    pub ctx: Value,
    /// What this device grants, within what the action declares.
    pub granted: Needs,
    /// The moment a clock run is for.
    pub slot: Option<Timestamp>,
}

/// A place whose trigger fired, held back by its window.
#[derive(Debug, Clone, PartialEq)]
pub struct Held {
    pub key: String,
    pub action: String,
    pub why: String,
    pub until: Option<Timestamp>,
}

/// An action that would run if this device granted what it's missing.
#[derive(Debug, Clone, PartialEq)]
pub struct Ungranted {
    pub action: String,
    pub missing: Needs,
    pub keys: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Plan {
    pub runs: Vec<Run>,
    pub held: Vec<Held>,
    pub ungranted: Vec<Ungranted>,
    pub problems: Vec<Problem>,
}

fn kw(s: &str) -> Value {
    Value::Keyword(s.into())
}

fn field<'a>(map: &'a Value, name: &str) -> Option<&'a Value> {
    let Value::Map(entries) = map else {
        return None;
    };
    entries
        .iter()
        .find(|(k, _)| matches!(k, Value::Keyword(k) | Value::Str(k) if k == name))
        .map(|(_, v)| v)
}

fn empty(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Nil) => true,
        Some(Value::Str(s)) => s.is_empty(),
        _ => false,
    }
}

/// Whether the cell an `[:edit name]` trigger watches has something in it
/// that the last run wasn't made from.
fn inputs_changed(place: &Place, name: &str) -> bool {
    let now = field(&place.inputs, name);
    let then = place.from.as_ref().and_then(|f| field(f, name));
    !empty(now) && now != then
}

/// Whether `event` fires `trigger` at `place`, and whether it does so
/// because the place's inputs changed, which a fresh value doesn't hold back.
fn fires(trigger: &Trigger, event: &Event, place: &Place) -> (bool, bool) {
    match (trigger, event) {
        (Trigger::Open, Event::Open) => (true, false),
        (Trigger::At(_) | Trigger::Cron(..), Event::Open | Event::Tick) => (true, false),
        (Trigger::Tap | Trigger::None, Event::Tap(key)) => (*key == place.key, false),
        // A format that records what a value was made from sees an edit
        // whenever it's made, by any app: the record no longer matches.
        (Trigger::Edit(name), Event::Open) if place.from.is_some() => {
            let changed = inputs_changed(place, name);
            (changed, changed)
        }
        (Trigger::Edit(name), Event::Edit { name: edited, row }) if name == edited => {
            let here = row
                .as_ref()
                .is_none_or(|r| place.key.starts_with(&format!("r:{r}:")));
            let changed = place.from.is_none() || inputs_changed(place, name);
            (here && changed, here && changed)
        }
        (Trigger::Change(path), Event::Change(changed)) => (path == changed, false),
        _ => (false, false),
    }
}

fn missing(declared: &Needs, granted: &Needs) -> Needs {
    Needs {
        fetch: declared
            .fetch
            .iter()
            .filter(|h| !granted.fetch.contains(h))
            .cloned()
            .collect(),
        read: declared
            .read
            .iter()
            .filter(|p| !granted.read.contains(p))
            .cloned()
            .collect(),
        locate: declared.locate && !granted.locate,
        ask: declared.ask && !granted.ask,
    }
}

fn within(declared: &Needs, granted: &Needs) -> Needs {
    Needs {
        fetch: declared
            .fetch
            .iter()
            .filter(|h| granted.fetch.contains(h))
            .cloned()
            .collect(),
        read: declared
            .read
            .iter()
            .filter(|p| granted.read.contains(p))
            .cloned()
            .collect(),
        locate: declared.locate && granted.locate,
        ask: declared.ask && granted.ask,
    }
}

/// What runs for `event`. `grants` says what this device grants each action,
/// by id. `base_ctx` is what the app knows about this run (its locale, the
/// member, the device, its timeout): every run's `ctx` starts from it.
pub fn plan(
    doc: &Doc,
    event: &Event,
    now: Timestamp,
    local_zone: Option<&str>,
    grants: &dyn Fn(&str) -> Needs,
    base_ctx: &Value,
) -> Plan {
    let mut out = Plan {
        problems: doc.problems.clone(),
        ..Plan::default()
    };
    for place in &doc.places {
        let Some(defined) = doc.action(&place.action) else {
            out.problems.push(Problem {
                about: place.key.clone(),
                message: format!("no action {} in this document", place.action),
            });
            continue;
        };
        let Ok(action) = parse_action(&defined.edn) else {
            continue;
        };
        let (fired, for_new_inputs) = fires(&action.on, event, place);
        if !fired {
            continue;
        }
        let last = match place.at.as_deref().map(str::parse::<Timestamp>) {
            Some(Ok(t)) => Some(t),
            Some(Err(_)) => {
                out.problems.push(Problem {
                    about: place.key.clone(),
                    message: format!(
                        "{:?} isn't a time; the value is treated as never run",
                        place.at
                    ),
                });
                None
            }
            None => None,
        };
        let fresh = action.fresh.as_deref().filter(|_| !for_new_inputs);
        let slot = match due(&action.on, fresh, last, now, local_zone) {
            Ok(Due::Now { slot }) => slot,
            Ok(Due::Later { until, why }) => {
                out.held.push(Held {
                    key: place.key.clone(),
                    action: action.id.clone(),
                    why: why.into(),
                    until,
                });
                continue;
            }
            Err(message) => {
                out.problems.push(Problem {
                    about: action.id.clone(),
                    message,
                });
                continue;
            }
        };
        let granted = grants(&action.id);
        let lacks = missing(&action.needs, &granted);
        if lacks != Needs::default() {
            match out.ungranted.iter_mut().find(|u| u.action == action.id) {
                Some(u) => u.keys.push(place.key.clone()),
                None => out.ungranted.push(Ungranted {
                    action: action.id.clone(),
                    missing: lacks,
                    keys: vec![place.key.clone()],
                }),
            }
            continue;
        }
        let trigger = match (&action.on, event) {
            (Trigger::At(_) | Trigger::Cron(..), _) => kw("clock"),
            (_, Event::Open) => kw("open"),
            (_, Event::Tick) => kw("clock"),
            (_, Event::Tap(_)) => kw("tap"),
            (_, Event::Edit { name, .. }) => {
                Value::Vector(vec![kw("edit"), Value::Str(name.clone())])
            }
            (_, Event::Change(path)) => Value::Vector(vec![kw("change"), Value::Str(path.clone())]),
        };
        let mut ctx = match base_ctx {
            Value::Map(entries) => entries.clone(),
            _ => Vec::new(),
        };
        ctx.retain(|(k, _)| !matches!(k, Value::Keyword(k) if ["trigger", "action", "place", "last", "last-at", "slot"].contains(&k.as_str())));
        ctx.push((kw("trigger"), trigger));
        ctx.push((kw("action"), kw(&action.id)));
        ctx.push((kw("place"), Value::Str(place.key.clone())));
        if place.at.is_some() {
            ctx.push((kw("last"), place.value.clone()));
            ctx.push((
                kw("last-at"),
                Value::Str(place.at.clone().unwrap_or_default()),
            ));
        }
        if let Some(slot) = slot {
            ctx.push((kw("slot"), Value::Str(slot.to_string())));
        }
        out.runs.push(Run {
            key: place.key.clone(),
            action: action.id.clone(),
            edn: defined.edn.clone(),
            request: place.inputs.clone(),
            ctx: Value::Map(ctx),
            granted: within(&action.needs, &granted),
            slot,
        });
    }
    out
}
