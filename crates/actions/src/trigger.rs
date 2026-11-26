//! When an action runs: `:on`, read from its EDN (`docs/actions/reference.md`, Triggers).
//!
//! Document triggers (`:open`, `:tap`, `[:edit …]`, `[:change …]`) are events
//! the app sees. Clock triggers are `[:at …]`, once at a moment written as
//! RFC 9557, and `[:cron …]`, a schedule in UTC, in a named IANA zone, or in
//! each member's own zone. A schedule is a cron map or a five-field cron
//! string, which read as the same thing.

use jiff::civil::{Date, DateTime};
use jiff::tz::TimeZone;
use jiff::{Timestamp, Zoned};
use workspace_edn::{print, Value};

#[derive(Debug, Clone, PartialEq)]
pub enum Trigger {
    /// No `:on`: the action runs only when the app runs it.
    None,
    Open,
    Tap,
    /// That field, or that text, changed.
    Edit(String),
    /// That file changed, by path relative to the document.
    Change(String),
    /// Once, at that moment.
    At(Timestamp),
    Cron(Cron, Zone),
    /// A trigger a later version adds: kept, never fired by this one.
    Unknown(Value),
}

/// Which clock a schedule reads.
#[derive(Debug, Clone, PartialEq)]
pub enum Zone {
    Utc,
    /// An IANA zone name, so the schedule follows its daylight saving.
    Named(String),
    /// Each member's own zone: one run for each of them.
    Local,
}

/// A schedule: for each field, the values it matches, ascending. A field
/// left out of a map is every value (`*`), except milliseconds and seconds,
/// which are 0, so a map without them runs when cron would.
#[derive(Debug, Clone, PartialEq)]
pub struct Cron {
    pub millisecond: Vec<u32>,
    pub second: Vec<u32>,
    pub minute: Vec<u32>,
    pub hour: Vec<u32>,
    pub day: Vec<u32>,
    pub month: Vec<u32>,
    /// 0 is Sunday.
    pub weekday: Vec<u32>,
    /// Whether the day of the month and the weekday were each restricted, for
    /// cron's rule: when both are, a day matching either one runs.
    day_restricted: bool,
    weekday_restricted: bool,
}

const MONTHS: [&str; 12] = [
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];
const WEEKDAYS: [&str; 7] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/// Read `:on`. Anything this version doesn't know is kept as `Unknown`, so a
/// later version can add a trigger without older ones refusing the action.
pub fn parse(on: Option<&Value>) -> Result<Trigger, String> {
    let Some(on) = on else {
        return Ok(Trigger::None);
    };
    match on {
        Value::Keyword(k) if k == "open" => Ok(Trigger::Open),
        Value::Keyword(k) if k == "tap" => Ok(Trigger::Tap),
        Value::Vector(items) => match items.as_slice() {
            [Value::Keyword(k), Value::Str(f)] if k == "edit" => Ok(Trigger::Edit(f.clone())),
            [Value::Keyword(k), Value::Str(f)] if k == "change" => Ok(Trigger::Change(f.clone())),
            [Value::Keyword(k), Value::Str(at)] if k == "at" => parse_at(at).map(Trigger::At),
            [Value::Keyword(k), schedule, rest @ ..] if k == "cron" => {
                let cron = match schedule {
                    Value::Str(s) => Cron::parse_str(s)?,
                    Value::Map(_) => Cron::parse_map(schedule)?,
                    _ => {
                        return Err("[:cron …] takes a cron map or a five-field cron string".into())
                    }
                };
                let zone =
                    match rest {
                        [] => Zone::Utc,
                        [Value::Keyword(t), Value::Keyword(l)] if t == "tz" && l == "local" => {
                            Zone::Local
                        }
                        [Value::Keyword(t), Value::Str(name)] if t == "tz" => {
                            TimeZone::get(name).map_err(|_| {
                                format!("{name:?} isn't an IANA time zone, like \"Europe/Madrid\"")
                            })?;
                            Zone::Named(name.clone())
                        }
                        _ => return Err(
                            "after the schedule, [:cron …] takes :tz \"Zone/Name\" or :tz :local"
                                .into(),
                        ),
                    };
                Ok(Trigger::Cron(cron, zone))
            }
            [Value::Keyword(k), ..] if ["edit", "change", "at", "cron"].contains(&k.as_str()) => {
                Err(format!(
                    "{} isn't written right; see the reference's Triggers",
                    print(on)
                ))
            }
            _ => Ok(Trigger::Unknown(on.clone())),
        },
        _ => Ok(Trigger::Unknown(on.clone())),
    }
}

/// A moment as RFC 9557 writes it, `2026-11-26T09:00:00+01:00[Europe/Madrid]`,
/// or as RFC 3339 does, with an offset or `Z` and no zone. A zone that
/// disagrees with the offset is refused rather than guessed.
pub fn parse_at(s: &str) -> Result<Timestamp, String> {
    let bad = |_| {
        format!("{s:?} isn't a moment; write it as RFC 9557 does, like \"2026-11-26T09:00:00+01:00[Europe/Madrid]\"")
    };
    if s.contains('[') {
        // A named zone: its offset must agree, so a mistake is refused rather than guessed.
        return s
            .parse::<Zoned>()
            .map(|z| z.timestamp())
            .map_err(|e| format!("{}: {e}", bad(())));
    }
    s.parse::<Timestamp>().map_err(|_| {
        format!("{s:?} isn't a moment; write it as RFC 9557 does, like \"2026-11-26T09:00:00+01:00[Europe/Madrid]\"")
    })
}

impl Zone {
    /// The zone to read a schedule in. `local` is the member's own zone, which
    /// only the app knows; it's needed only for `Zone::Local`.
    pub fn resolve(&self, local: Option<&str>) -> Result<TimeZone, String> {
        match self {
            Zone::Utc => Ok(TimeZone::UTC),
            Zone::Named(n) => TimeZone::get(n).map_err(|e| e.to_string()),
            Zone::Local => match local {
                Some(n) => TimeZone::get(n).map_err(|_| format!("{n:?} isn't an IANA time zone")),
                None => Err("a schedule in each member's own zone needs that member's zone".into()),
            },
        }
    }
}

impl Cron {
    /// Cron's five fields: minute, hour, day of the month, month, weekday.
    pub fn parse_str(s: &str) -> Result<Cron, String> {
        let fields: Vec<&str> = s.split_whitespace().collect();
        let [minute, hour, day, month, weekday] = fields.as_slice() else {
            return Err(format!(
                "{s:?} isn't a five-field cron string, like \"0 9 * * 1-5\""
            ));
        };
        Ok(Cron {
            millisecond: vec![0],
            second: vec![0],
            minute: field(minute, 0, 59, &[], "minute")?,
            hour: field(hour, 0, 23, &[], "hour")?,
            day: field(day, 1, 31, &[], "day")?,
            month: field(month, 1, 12, &MONTHS, "month")?,
            weekday: weekdays(field(weekday, 0, 7, &WEEKDAYS, "weekday")?),
            day_restricted: !day.starts_with('*'),
            weekday_restricted: !weekday.starts_with('*'),
        })
    }

    /// `{:minute 0 :hour 9 :weekday [:mon :fri]}`. A value is a number, a list
    /// of them, or cron's own text for a step or range (`"*/15"`, `"9-17"`).
    pub fn parse_map(v: &Value) -> Result<Cron, String> {
        let Value::Map(entries) = v else {
            return Err("a cron map is a map".into());
        };
        let mut cron = Cron {
            millisecond: vec![0],
            second: vec![0],
            minute: (0..=59).collect(),
            hour: (0..=23).collect(),
            day: (1..=31).collect(),
            month: (1..=12).collect(),
            weekday: (0..=6).collect(),
            day_restricted: false,
            weekday_restricted: false,
        };
        for (k, v) in entries {
            let Value::Keyword(k) = k else {
                return Err(format!("{} isn't a cron key", print(k)));
            };
            match k.as_str() {
                "millisecond" => cron.millisecond = map_field(v, 0, 999, &[], k)?,
                "second" => cron.second = map_field(v, 0, 59, &[], k)?,
                "minute" => cron.minute = map_field(v, 0, 59, &[], k)?,
                "hour" => cron.hour = map_field(v, 0, 23, &[], k)?,
                "day" => {
                    cron.day = map_field(v, 1, 31, &[], k)?;
                    cron.day_restricted = true;
                }
                "month" => cron.month = map_field(v, 1, 12, &MONTHS, k)?,
                "weekday" => {
                    cron.weekday = weekdays(map_field(v, 0, 7, &WEEKDAYS, k)?);
                    cron.weekday_restricted = true;
                }
                other => {
                    return Err(format!(
                        ":{other} isn't a cron key; the keys are :millisecond :second :minute :hour :day :month :weekday"
                    ))
                }
            }
        }
        Ok(cron)
    }

    fn day_matches(&self, d: Date) -> bool {
        if !self.month.contains(&(d.month() as u32)) {
            return false;
        }
        let by_day = self.day.contains(&(d.day() as u32));
        let by_weekday = self
            .weekday
            .contains(&(d.weekday().to_sunday_zero_offset() as u32));
        match (self.day_restricted, self.weekday_restricted) {
            (true, true) => by_day || by_weekday,
            _ => by_day && by_weekday,
        }
    }

    /// The times of day this schedule runs at, ascending, as (hour, minute, second, millisecond).
    fn times(&self) -> impl DoubleEndedIterator<Item = (u32, u32, u32, u32)> + '_ {
        self.hour.iter().flat_map(move |&h| {
            self.minute.iter().flat_map(move |&m| {
                self.second
                    .iter()
                    .flat_map(move |&s| self.millisecond.iter().map(move |&ms| (h, m, s, ms)))
            })
        })
    }

    /// The first run strictly after `after`, read in `tz`.
    pub fn next_after(&self, after: Timestamp, tz: &TimeZone) -> Option<Timestamp> {
        let mut day = after.to_zoned(tz.clone()).date().yesterday().ok()?;
        // Eight years covers every schedule that can run at all (29 February on a given weekday repeats within 28).
        for _ in 0..(366 * 8 + 2) {
            if self.day_matches(day) {
                for t in self.times() {
                    if let Some(at) = at_time(day, t, tz) {
                        if at > after {
                            return Some(at);
                        }
                    }
                }
            }
            day = day.tomorrow().ok()?;
        }
        None
    }

    /// The latest run at or before `at`, read in `tz`: the slot `at` falls in.
    pub fn slot_at(&self, at: Timestamp, tz: &TimeZone) -> Option<Timestamp> {
        let mut day = at.to_zoned(tz.clone()).date().tomorrow().ok()?;
        for _ in 0..(366 * 8 + 2) {
            if self.day_matches(day) {
                for t in self.times().rev() {
                    if let Some(run) = at_time(day, t, tz) {
                        if run <= at {
                            return Some(run);
                        }
                    }
                }
            }
            day = day.yesterday().ok()?;
        }
        None
    }
}

/// A local time on a day, as a moment. When the clocks change, a time that's
/// skipped moves forward by the gap and a time that happens twice is its
/// first, as RFC 5545 has it (jiff's "compatible" disambiguation).
fn at_time(day: Date, (h, m, s, ms): (u32, u32, u32, u32), tz: &TimeZone) -> Option<Timestamp> {
    let dt = DateTime::new(
        day.year(),
        day.month(),
        day.day(),
        h as i8,
        m as i8,
        s as i8,
        (ms * 1_000_000) as i32,
    )
    .ok()?;
    tz.to_ambiguous_zoned(dt)
        .compatible()
        .ok()
        .map(|z| z.timestamp())
}

/// Weekday 7 is Sunday, as cron allows; fold it into 0.
fn weekdays(mut v: Vec<u32>) -> Vec<u32> {
    for d in v.iter_mut() {
        if *d == 7 {
            *d = 0;
        }
    }
    v.sort_unstable();
    v.dedup();
    v
}

fn map_field(v: &Value, lo: u32, hi: u32, names: &[&str], key: &str) -> Result<Vec<u32>, String> {
    let one = |x: &Value| -> Result<Vec<u32>, String> {
        match x {
            Value::Int(n) if (lo as i64..=hi as i64).contains(n) => Ok(vec![*n as u32]),
            Value::Int(n) => Err(format!(":{key} {n} is outside {lo}–{hi}")),
            Value::Keyword(name) => named(name, lo, names)
                .map(|n| vec![n])
                .ok_or_else(|| format!(":{key} doesn't know :{name}")),
            Value::Str(s) => field(s, lo, hi, names, key),
            other => Err(format!(":{key} can't be {}", print(other))),
        }
    };
    let mut out = match v {
        Value::Vector(xs) | Value::List(xs) | Value::Set(xs) => {
            let mut out = vec![];
            for x in xs {
                out.extend(one(x)?);
            }
            out
        }
        other => one(other)?,
    };
    if out.is_empty() {
        return Err(format!(":{key} matches nothing"));
    }
    out.sort_unstable();
    out.dedup();
    Ok(out)
}

/// A name's number: months count from 1, weekdays from 0 (Sunday).
fn named(name: &str, lo: u32, names: &[&str]) -> Option<u32> {
    let i = names.iter().position(|n| n.eq_ignore_ascii_case(name))? as u32;
    Some(if lo == 1 { i + 1 } else { i })
}

/// One cron field: `*`, `5`, `1-5`, `*/15`, `9-17/2`, `mon`, or a list of them with commas.
fn field(s: &str, lo: u32, hi: u32, names: &[&str], key: &str) -> Result<Vec<u32>, String> {
    let bad = || format!("{s:?} isn't a cron {key} ({lo}–{hi})");
    let num = |t: &str| -> Result<u32, String> {
        t.parse::<u32>()
            .ok()
            .or_else(|| named(t, lo, names))
            .filter(|n| (lo..=hi).contains(n))
            .ok_or_else(bad)
    };
    let mut out = vec![];
    for part in s.split(',') {
        let (range, step) = match part.split_once('/') {
            Some((r, st)) => (
                r,
                st.parse::<u32>().ok().filter(|n| *n > 0).ok_or_else(bad)?,
            ),
            None => (part, 1),
        };
        let (a, b) = if range == "*" {
            (lo, hi)
        } else if let Some((a, b)) = range.split_once('-') {
            (num(a)?, num(b)?)
        } else {
            let n = num(range)?;
            (n, if part.contains('/') { hi } else { n })
        };
        if a > b {
            return Err(bad());
        }
        out.extend((a..=b).step_by(step as usize));
    }
    out.sort_unstable();
    out.dedup();
    Ok(out)
}
