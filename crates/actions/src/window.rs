//! One run per window (`docs/actions/running.md`): before running an action,
//! a device reads the latest run record and doesn't run it again when a run
//! already landed within its window.
//!
//! | Trigger | The window |
//! | --- | --- |
//! | `:fresh` given | That long since the last run |
//! | `[:at …]` | That moment: once it has run, never again |
//! | `[:cron …]` | The slot: the run for 09:00 covers 09:00 until the next slot |
//! | `[:cron … :tz :local]` | The slot, for each member |
//! | document triggers | No window: each one is its own run |

use jiff::{Span, Timestamp, Zoned};

use crate::trigger::Trigger;

#[derive(Debug, Clone, PartialEq)]
pub enum Due {
    /// Run it. `slot` is the moment this run is for, when the trigger is a clock:
    /// the run record carries it, so other devices see this slot is taken.
    Now { slot: Option<Timestamp> },
    /// Don't run it. `until` is when it can next be due, if that's known.
    Later {
        until: Option<Timestamp>,
        why: &'static str,
    },
}

/// Whether an action is due at `now`. `last_run` is the moment of the latest
/// run record (the `kept` marker's time, or the run record in the workspace's
/// log): for a clock, the slot that run was for. `fresh` is the action's
/// `:fresh`, an ISO 8601 duration. `local_zone` is this member's IANA zone,
/// needed only for `:tz :local`.
///
/// A document trigger (`:open`, `:tap`, `[:edit …]`, `[:change …]`) is due
/// when its event happens; this answers only whether `:fresh` holds it back.
pub fn due(
    trigger: &Trigger,
    fresh: Option<&str>,
    last_run: Option<Timestamp>,
    now: Timestamp,
    local_zone: Option<&str>,
) -> Result<Due, String> {
    if let (Some(fresh), Some(last)) = (fresh, last_run) {
        let until = add_duration(last, fresh)?;
        if now < until {
            return Ok(Due::Later {
                until: Some(until),
                why: "the kept value is still fresh",
            });
        }
    }
    match trigger {
        Trigger::At(at) => Ok(if now < *at {
            Due::Later {
                until: Some(*at),
                why: "its moment hasn't come",
            }
        } else if last_run.is_some_and(|l| l >= *at) {
            Due::Later {
                until: None,
                why: "it ran at its moment, and runs only once",
            }
        } else {
            Due::Now { slot: Some(*at) }
        }),
        Trigger::Cron(cron, zone) => {
            let tz = zone.resolve(local_zone)?;
            match cron.slot_at(now, &tz) {
                Some(slot) if last_run.is_none_or(|l| l < slot) => {
                    Ok(Due::Now { slot: Some(slot) })
                }
                _ => Ok(Due::Later {
                    until: cron.next_after(now, &tz),
                    why: "this slot has already run",
                }),
            }
        }
        Trigger::Unknown(_) => Ok(Due::Later {
            until: None,
            why: "this version doesn't know the trigger",
        }),
        Trigger::None | Trigger::Open | Trigger::Tap | Trigger::Edit(_) | Trigger::Change(_) => {
            Ok(Due::Now { slot: None })
        }
    }
}

/// `at` plus an ISO 8601 duration (`"P1D"`, `"PT15M"`, `"P1M"`). Days and
/// longer are counted in UTC, so `"P1D"` is always 24 hours.
pub fn add_duration(at: Timestamp, duration: &str) -> Result<Timestamp, String> {
    let span: Span = duration
        .parse()
        .map_err(|_| format!("{duration:?} isn't an ISO 8601 duration, like \"P1D\""))?;
    let z: Zoned = at.to_zoned(jiff::tz::TimeZone::UTC);
    z.checked_add(span)
        .map(|z| z.timestamp())
        .map_err(|e| e.to_string())
}
