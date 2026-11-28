//! Triggers and windows, against `docs/actions/reference.md` (Triggers) and
//! `docs/actions/running.md` (One run per window).

use jiff::tz::TimeZone;
use jiff::Timestamp;
use workspace_actions::trigger::{parse, parse_at, Cron, Trigger, Zone};
use workspace_actions::window::{add_duration, due, Due};
use workspace_edn::read;

fn t(s: &str) -> Timestamp {
    s.parse().unwrap()
}

fn on(s: &str) -> Result<Trigger, String> {
    parse(Some(&read(s).unwrap()))
}

fn cron_of(s: &str) -> (Cron, Zone) {
    match on(s).unwrap() {
        Trigger::Cron(c, z) => (c, z),
        other => panic!("{other:?}"),
    }
}

#[test]
fn document_triggers_read_as_written() {
    assert_eq!(on(":open").unwrap(), Trigger::Open);
    assert_eq!(on(":tap").unwrap(), Trigger::Tap);
    assert_eq!(
        on(r#"[:edit "isbn"]"#).unwrap(),
        Trigger::Edit("isbn".into())
    );
    assert_eq!(
        on(r#"[:change "budget.table"]"#).unwrap(),
        Trigger::Change("budget.table".into())
    );
    assert_eq!(parse(None).unwrap(), Trigger::None);
}

#[test]
fn a_trigger_from_a_later_version_is_kept_not_refused() {
    assert!(matches!(
        on(r#"[:data "prices"]"#).unwrap(),
        Trigger::Unknown(_)
    ));
    assert!(matches!(on(":someday").unwrap(), Trigger::Unknown(_)));
}

#[test]
fn at_reads_rfc_9557_and_refuses_a_zone_that_disagrees_with_its_offset() {
    assert_eq!(
        on(r#"[:at "2026-11-26T09:00:00+01:00[Europe/Madrid]"]"#).unwrap(),
        Trigger::At(t("2026-11-26T08:00:00Z"))
    );
    assert_eq!(
        parse_at("2026-11-26T08:00:00Z").unwrap(),
        t("2026-11-26T08:00:00Z")
    );
    // Madrid is +01:00 in November, not +02:00.
    assert!(parse_at("2026-11-26T09:00:00+02:00[Europe/Madrid]").is_err());
    assert!(on(r#"[:at "tomorrow at nine"]"#).is_err());
}

#[test]
fn the_cron_string_and_the_cron_map_are_the_same_schedule() {
    let (s, _) = cron_of(r#"[:cron "0 9 * * 1-5"]"#);
    let (m, _) = cron_of("[:cron {:minute 0 :hour 9 :weekday [:mon :tue :wed :thu :fri]}]");
    assert_eq!(s, m);
    let (s, _) = cron_of(r#"[:cron "*/15 9-17 * * *"]"#);
    let (m, _) = cron_of(r#"[:cron {:minute "*/15" :hour "9-17"}]"#);
    assert_eq!(s, m);
}

#[test]
fn a_cron_map_without_seconds_runs_when_cron_would() {
    let (c, _) = cron_of("[:cron {:minute 30 :hour 9}]");
    assert_eq!(c.second, vec![0]);
    assert_eq!(c.millisecond, vec![0]);
    let next = c
        .next_after(t("2026-11-26T09:30:00Z"), &TimeZone::UTC)
        .unwrap();
    assert_eq!(next, t("2026-11-27T09:30:00Z"));
}

#[test]
fn seconds_and_milliseconds_go_beyond_cron() {
    let (c, _) = cron_of(r#"[:cron {:millisecond [0 500] :second "*"}]"#);
    let next = c
        .next_after(t("2026-11-26T09:00:00Z"), &TimeZone::UTC)
        .unwrap();
    assert_eq!(next, t("2026-11-26T09:00:00.5Z"));
}

#[test]
fn weekdays_count_sunday_as_0_and_7() {
    let (a, _) = cron_of(r#"[:cron "0 9 * * 0"]"#);
    let (b, _) = cron_of(r#"[:cron "0 9 * * 7"]"#);
    let (c, _) = cron_of("[:cron {:minute 0 :hour 9 :weekday :sun}]");
    assert_eq!(a, b);
    assert_eq!(a, c);
    // 26 Nov 2026 is a Thursday; the next Sunday is the 29th.
    assert_eq!(
        a.next_after(t("2026-11-26T00:00:00Z"), &TimeZone::UTC),
        Some(t("2026-11-29T09:00:00Z"))
    );
}

#[test]
fn a_day_and_a_weekday_together_run_on_either_as_cron_does() {
    // The 1st of the month, or any Monday.
    let (c, _) = cron_of(r#"[:cron "0 9 1 * mon"]"#);
    assert_eq!(
        c.next_after(t("2026-11-26T00:00:00Z"), &TimeZone::UTC),
        Some(t("2026-11-30T09:00:00Z"))
    );
    assert_eq!(
        c.next_after(t("2026-11-30T10:00:00Z"), &TimeZone::UTC),
        Some(t("2026-12-01T09:00:00Z"))
    );
}

#[test]
fn a_named_zone_follows_its_daylight_saving() {
    let (c, z) = cron_of(r#"[:cron {:minute 0 :hour 9} :tz "Europe/Madrid"]"#);
    assert_eq!(z, Zone::Named("Europe/Madrid".into()));
    let tz = z.resolve(None).unwrap();
    // 09:00 in Madrid is 07:00 UTC in summer and 08:00 UTC in winter.
    assert_eq!(
        c.next_after(t("2026-10-24T12:00:00Z"), &tz),
        Some(t("2026-10-25T08:00:00Z"))
    );
    assert_eq!(
        c.next_after(t("2026-10-23T12:00:00Z"), &tz),
        Some(t("2026-10-24T07:00:00Z"))
    );
}

#[test]
fn a_skipped_time_moves_forward_by_the_gap() {
    // Madrid skips 02:00–03:00 on 29 Mar 2026; 02:30 becomes 03:30 local, 01:30 UTC.
    let (c, z) = cron_of(r#"[:cron {:minute 30 :hour 2} :tz "Europe/Madrid"]"#);
    let tz = z.resolve(None).unwrap();
    assert_eq!(
        c.next_after(t("2026-03-28T12:00:00Z"), &tz),
        Some(t("2026-03-29T01:30:00Z"))
    );
}

#[test]
fn a_time_that_happens_twice_runs_once() {
    // Madrid repeats 02:00–03:00 on 25 Oct 2026. 02:30 runs at its first, 00:30 UTC, and not again at 01:30 UTC.
    let (c, z) = cron_of(r#"[:cron {:minute 30 :hour 2} :tz "Europe/Madrid"]"#);
    let tz = z.resolve(None).unwrap();
    let first = c.next_after(t("2026-10-24T12:00:00Z"), &tz).unwrap();
    assert_eq!(first, t("2026-10-25T00:30:00Z"));
    assert_eq!(c.next_after(first, &tz), Some(t("2026-10-26T01:30:00Z")));
}

#[test]
fn a_schedule_that_can_never_run_has_no_next_run() {
    let (c, _) = cron_of(r#"[:cron "0 9 31 2 *"]"#);
    assert_eq!(
        c.next_after(t("2026-11-26T00:00:00Z"), &TimeZone::UTC),
        None
    );
}

#[test]
fn twenty_ninth_of_february_is_found_years_ahead() {
    let (c, _) = cron_of(r#"[:cron "0 0 29 2 *"]"#);
    assert_eq!(
        c.next_after(t("2026-11-26T00:00:00Z"), &TimeZone::UTC),
        Some(t("2028-02-29T00:00:00Z"))
    );
}

#[test]
fn bad_schedules_say_what_is_wrong() {
    assert!(on(r#"[:cron "0 9 * *"]"#)
        .unwrap_err()
        .contains("five-field"));
    assert!(on("[:cron {:hour 24}]").unwrap_err().contains("outside"));
    assert!(on("[:cron {:hours 9}]")
        .unwrap_err()
        .contains("isn't a cron key"));
    assert!(on(r#"[:cron {:hour 9} :tz "Europe/Madird"]"#)
        .unwrap_err()
        .contains("IANA"));
}

// ---------------------------------------------------------------------------
// One run per window
// ---------------------------------------------------------------------------

#[test]
fn a_slot_that_already_ran_is_not_due_again() {
    let trig = on("[:cron {:minute 0 :hour 9}]").unwrap();
    let now = t("2026-11-26T09:00:20Z");
    // Nobody has run the 09:00 slot: due, and the record will say which slot.
    assert_eq!(
        due(&trig, None, Some(t("2026-11-25T09:00:00Z")), now, None).unwrap(),
        Due::Now {
            slot: Some(t("2026-11-26T09:00:00Z"))
        }
    );
    // Another device ran it a few seconds ago: not due until tomorrow's slot.
    assert_eq!(
        due(&trig, None, Some(t("2026-11-26T09:00:00Z")), now, None).unwrap(),
        Due::Later {
            until: Some(t("2026-11-27T09:00:00Z")),
            why: "this slot has already run"
        }
    );
}

#[test]
fn a_device_coming_online_late_runs_the_slot_it_missed_once() {
    let trig = on("[:cron {:minute 0 :hour 9}]").unwrap();
    // Offline all morning; online at 14:00. The 09:00 slot hasn't run, so it runs now, once.
    assert_eq!(
        due(
            &trig,
            None,
            Some(t("2026-11-25T09:00:00Z")),
            t("2026-11-26T14:00:00Z"),
            None
        )
        .unwrap(),
        Due::Now {
            slot: Some(t("2026-11-26T09:00:00Z"))
        }
    );
}

#[test]
fn at_runs_once_at_its_moment() {
    let trig = on(r#"[:at "2026-11-26T09:00:00+01:00[Europe/Madrid]"]"#).unwrap();
    let at = t("2026-11-26T08:00:00Z");
    assert!(
        matches!(due(&trig, None, None, t("2026-11-26T07:59:59Z"), None).unwrap(), Due::Later { until: Some(u), .. } if u == at)
    );
    assert_eq!(
        due(&trig, None, None, t("2026-11-26T08:00:01Z"), None).unwrap(),
        Due::Now { slot: Some(at) }
    );
    assert!(matches!(
        due(&trig, None, Some(at), t("2026-11-27T08:00:00Z"), None).unwrap(),
        Due::Later { until: None, .. }
    ));
}

#[test]
fn fresh_holds_back_a_document_trigger() {
    let trig = on(":open").unwrap();
    let last = t("2026-11-25T09:00:00Z");
    assert!(matches!(
        due(
            &trig,
            Some("P1D"),
            Some(last),
            t("2026-11-25T20:00:00Z"),
            None
        )
        .unwrap(),
        Due::Later { .. }
    ));
    assert_eq!(
        due(
            &trig,
            Some("P1D"),
            Some(last),
            t("2026-11-26T09:00:01Z"),
            None
        )
        .unwrap(),
        Due::Now { slot: None }
    );
    assert_eq!(
        due(&trig, None, Some(last), t("2026-11-25T09:00:01Z"), None).unwrap(),
        Due::Now { slot: None }
    );
}

#[test]
fn a_local_schedule_runs_in_each_members_zone() {
    let trig = on("[:cron {:minute 0 :hour 9} :tz :local]").unwrap();
    let now = t("2026-11-26T08:30:00Z");
    // 08:30 UTC: past 09:00 in Madrid (09:30), not yet in London (08:30).
    assert_eq!(
        due(
            &trig,
            None,
            Some(t("2026-11-25T08:00:00Z")),
            now,
            Some("Europe/Madrid")
        )
        .unwrap(),
        Due::Now {
            slot: Some(t("2026-11-26T08:00:00Z"))
        }
    );
    assert!(matches!(
        due(
            &trig,
            None,
            Some(t("2026-11-25T09:00:00Z")),
            now,
            Some("Europe/London")
        )
        .unwrap(),
        Due::Later { .. }
    ));
    assert!(due(&trig, None, None, now, None).is_err());
}

#[test]
fn fresh_durations_count_calendar_units() {
    assert_eq!(
        add_duration(t("2026-11-26T09:00:00Z"), "PT15M").unwrap(),
        t("2026-11-26T09:15:00Z")
    );
    assert_eq!(
        add_duration(t("2026-01-31T09:00:00Z"), "P1M").unwrap(),
        t("2026-02-28T09:00:00Z")
    );
    assert!(add_duration(t("2026-01-31T09:00:00Z"), "a day").is_err());
}
