//! Workspace actions, `workspace-action-v1` (workspace-protocol `docs/actions/`).
//!
//! - [`action`]: read an action from its EDN and run it. An action only asks;
//!   the app performs each request and runs it again with the answers.
//! - [`trigger`]: read `:on`, and work out a schedule's runs.
//! - [`window`]: one run per window, so a workspace's devices don't each run
//!   the same action for the same moment.
//!
//! The EDN reader and printer are `workspace-edn`, shared with `.table`
//! formulas. This crate depends on it, never the other way round.

pub mod action;
pub mod api;
pub mod canvas;
pub mod json;
pub mod jsonspan;
pub mod markdown;
pub mod place;
pub mod plan;
pub mod table;
pub mod trigger;
pub mod window;

pub use action::{parse_action, run, run_text, Action, Answer, Input, Limits, Needs, Outcome};
pub use trigger::{Cron, Trigger, Zone};
pub use window::{due, Due};
pub use workspace_edn::Value;
