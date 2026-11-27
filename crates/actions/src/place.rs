//! What every format gives the engine: the actions a document defines, and
//! the places that keep a value one of them made (`docs/actions/in-files.md`).
//! A place is the same thing in every format: a `kept` marker in Markdown, a
//! node in a canvas, a cell in a `.table`.

use workspace_edn::Value;

/// One kept value, and what made it.
#[derive(Debug, Clone, PartialEq)]
pub struct Place {
    /// Which place this is, within the document as it was read: `m:0` (the
    /// first marker), `n:<node id>`, `r:<row id>:<field>`.
    pub key: String,
    /// The id of the action that keeps it.
    pub action: String,
    /// The action's inputs here: its `request`.
    pub inputs: Value,
    /// When it last ran, as written, or `None` if it never has.
    pub at: Option<String>,
    /// The value kept now: Markdown's text, a canvas node's text, a cell.
    pub value: Value,
    /// The inputs its last run recorded, where the format keeps them apart
    /// from the inputs now (a row's `x-kept`): when they differ, the value
    /// was made from something that has since changed.
    pub from: Option<Value>,
}

/// An action as a document holds it.
#[derive(Debug, Clone, PartialEq)]
pub struct Defined {
    pub id: String,
    /// The action's EDN, with the format's escapes undone.
    pub edn: String,
}

/// Something in a document that couldn't be read. Never fatal: the rest of
/// the document still reads.
#[derive(Debug, Clone, PartialEq)]
pub struct Problem {
    /// An action's id, a place's key, or the start of what couldn't be read.
    pub about: String,
    pub message: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Doc {
    pub actions: Vec<Defined>,
    pub places: Vec<Place>,
    pub problems: Vec<Problem>,
}

impl Doc {
    pub fn action(&self, id: &str) -> Option<&Defined> {
        self.actions.iter().find(|a| a.id == id)
    }
}

/// One value to write back: the place, as it was when the run began, the
/// moment of the run and what it kept.
#[derive(Debug, Clone, PartialEq)]
pub struct Update {
    pub key: String,
    pub action: String,
    /// The inputs the run was given. A place whose inputs have changed since
    /// is skipped: the value was made for inputs that are no longer there.
    pub inputs: Value,
    pub at: String,
    pub keep: Value,
}
