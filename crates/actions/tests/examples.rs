//! The worked examples in `docs/actions/examples.md`, run as written, so the
//! spec and the engine can't drift apart.

use workspace_actions::{parse_action, run, Answer, Input, Limits, Needs, Outcome, Trigger};
use workspace_edn::{print, read, Value};

/// Example 1, as `docs/actions/syntax.md` writes it.
const GEO_PLACE: &str = r#"
{:id :geo/place
 :on :open
 :fresh "P1D"
 :needs {:fetch ["nominatim.openstreetmap.org"]}
 :fn (fn [{:keys [q]} env ctx]
       (let [r (first (env/fetch "https://nominatim.openstreetmap.org/search"
                                 {:q q :format "json" :limit 1}))]
         {:keep [(:lat r) (:lon r)]}))}
"#;

/// Example 3: a canvas edge carrying a table's total.
const CANVAS_TOTAL: &str = r#"
{:id :canvas/total
 :on [:change "household-budget.table"]
 :needs {:read ["household-budget.table"]}
 :fn (fn [_ env ctx]
       (let [t (env/read "household-budget.table")]
         {:keep (str "Total: " (env/format :currency (sum (map :amount (:rows t)))))}))}
"#;

fn v(s: &str) -> Value {
    read(s).unwrap()
}

fn input(request: &str, granted: Needs, answers: Vec<(&str, Answer)>) -> Input {
    Input {
        request: v(request),
        ctx: Value::Nil,
        granted,
        answers: answers
            .into_iter()
            .map(|(r, a)| (print(&v(r)), a))
            .collect(),
    }
}

fn never() -> impl FnMut() -> bool {
    || false
}

fn fetch_nominatim() -> Needs {
    Needs {
        fetch: vec!["nominatim.openstreetmap.org".into()],
        ..Needs::default()
    }
}

const DUBLIN_REQUEST: &str = r#"{:op :fetch :url "https://nominatim.openstreetmap.org/search" :query {:q "Dublin" :format "json" :limit 1}}"#;

#[test]
fn example_1_reads_as_written() {
    let a = parse_action(GEO_PLACE).unwrap();
    assert_eq!(a.id, "geo/place");
    assert_eq!(a.on, Trigger::Open);
    assert_eq!(a.fresh.as_deref(), Some("P1D"));
    assert_eq!(a.needs, fetch_nominatim());
}

#[test]
fn example_1_asks_then_keeps_the_coordinates() {
    let a = parse_action(GEO_PLACE).unwrap();

    // First run: no answers yet, so it stops at the fetch and says what it needs.
    let first = run(
        &a,
        &input(r#"{:q "Dublin"}"#, fetch_nominatim(), vec![]),
        Limits::default(),
        &mut never(),
    );
    assert_eq!(
        first,
        Outcome::Needs {
            request: v(DUBLIN_REQUEST),
            asked: vec![]
        }
    );

    // The app performs it and runs again with the answer.
    let answer = Answer::Value(v(
        r#"[{:lat "53.3498" :lon "-6.2603" :display_name "Dublin"}]"#,
    ));
    let second = run(
        &a,
        &input(
            r#"{:q "Dublin"}"#,
            fetch_nominatim(),
            vec![(DUBLIN_REQUEST, answer)],
        ),
        Limits::default(),
        &mut never(),
    );
    let Outcome::Done { keep, show, asked } = second else {
        panic!("{second:?}")
    };
    assert_eq!(keep, Some(v(r#"["53.3498" "-6.2603"]"#)));
    assert_eq!(show, None);
    // The run record: the one request it used, and its answer.
    assert_eq!(asked.len(), 1);
    assert_eq!(asked[0].0, v(DUBLIN_REQUEST));
}

#[test]
fn example_1_offline_fails_as_offline() {
    let a = parse_action(GEO_PLACE).unwrap();
    let out = run(
        &a,
        &input(
            r#"{:q "Dublin"}"#,
            fetch_nominatim(),
            vec![(
                DUBLIN_REQUEST,
                Answer::Failed("offline".into(), String::new()),
            )],
        ),
        Limits::default(),
        &mut never(),
    );
    let Outcome::Failed { reason, .. } = out else {
        panic!("{out:?}")
    };
    assert_eq!(reason, "offline");
}

#[test]
fn example_1_without_the_grant_is_refused_before_the_app_is_asked() {
    let a = parse_action(GEO_PLACE).unwrap();
    let out = run(
        &a,
        &input(r#"{:q "Dublin"}"#, Needs::default(), vec![]),
        Limits::default(),
        &mut never(),
    );
    let Outcome::Failed {
        reason, message, ..
    } = out
    else {
        panic!("{out:?}")
    };
    assert_eq!(reason, "refused");
    assert!(message.contains("hasn't let"), "{message}");
}

#[test]
fn example_3_totals_the_table_it_reads() {
    let a = parse_action(CANVAS_TOTAL).unwrap();
    assert_eq!(a.on, Trigger::Change("household-budget.table".into()));
    let granted = Needs {
        read: vec!["household-budget.table".into()],
        ..Needs::default()
    };
    let read_req = r#"{:op :read :path "household-budget.table"}"#;
    let table = Answer::Value(v(
        r#"{:rows [{:item "Rent" :amount 14400} {:item "Food" :amount 4863} {:item "Gift" :amount nil}]}"#,
    ));

    let first = run(
        &a,
        &input("nil", granted.clone(), vec![]),
        Limits::default(),
        &mut never(),
    );
    assert_eq!(
        first,
        Outcome::Needs {
            request: v(read_req),
            asked: vec![]
        }
    );

    // With the table, it needs the total formatted: the app knows the locale and currency.
    let second = run(
        &a,
        &input("nil", granted.clone(), vec![(read_req, table.clone())]),
        Limits::default(),
        &mut never(),
    );
    let format_req = r#"{:op :format :as :currency :value 19263}"#;
    let Outcome::Needs { request, .. } = &second else {
        panic!("{second:?}")
    };
    assert_eq!(request, &v(format_req));

    let third = run(
        &a,
        &input(
            "nil",
            granted,
            vec![
                (read_req, table),
                (format_req, Answer::Value(Value::Str("£19,263".into()))),
            ],
        ),
        Limits::default(),
        &mut never(),
    );
    let Outcome::Done { keep, asked, .. } = third else {
        panic!("{third:?}")
    };
    assert_eq!(keep, Some(Value::Str("Total: £19,263".into())));
    assert_eq!(asked.len(), 2);
}

#[test]
fn a_misnamed_function_suggests_the_right_one() {
    let a = parse_action(r#"{:id :t/x :fn (fn [r] {:keep (cuont [1 2])})}"#).unwrap();
    let out = run(
        &a,
        &input("nil", Needs::default(), vec![]),
        Limits::default(),
        &mut never(),
    );
    let Outcome::Failed {
        reason,
        message,
        suggestions,
        ..
    } = out
    else {
        panic!("{out:?}")
    };
    assert_eq!(reason, "failed");
    assert!(message.contains("cuont"));
    assert_eq!(suggestions, vec!["count".to_string()]);
}

#[test]
fn a_misnamed_request_suggests_the_right_one() {
    let a =
        parse_action(r#"{:id :t/x :fn (fn [r] {:keep (env/fecth "https://a.example")})}"#).unwrap();
    let out = run(
        &a,
        &input("nil", Needs::default(), vec![]),
        Limits::default(),
        &mut never(),
    );
    let Outcome::Failed { suggestions, .. } = out else {
        panic!("{out:?}")
    };
    assert_eq!(suggestions, vec!["env/fetch".to_string()]);
}

#[test]
fn an_undeclared_host_names_the_declared_one() {
    let a = parse_action(
        r#"{:id :t/x :needs {:fetch ["nominatim.openstreetmap.org"]}
            :fn (fn [r] {:keep (env/fetch "https://nominatim.openstreetmap.com/search")})}"#,
    )
    .unwrap();
    let out = run(
        &a,
        &input("nil", fetch_nominatim(), vec![]),
        Limits::default(),
        &mut never(),
    );
    let Outcome::Failed {
        reason,
        suggestions,
        ..
    } = out
    else {
        panic!("{out:?}")
    };
    assert_eq!(reason, "refused");
    assert_eq!(suggestions, vec!["nominatim.openstreetmap.org".to_string()]);
}

#[test]
fn a_long_run_stops_when_the_runner_says_so() {
    // A million million additions: it would end, but long after any device's timeout.
    let a = parse_action(
        r#"{:id :t/slow :fn (fn [r] {:keep (reduce + (map (fn [i] (reduce + (range 1000000))) (range 1000000)))})}"#,
    )
    .unwrap();
    let mut calls = 0;
    let mut interrupt = || {
        calls += 1;
        calls > 50
    };
    let out = run(
        &a,
        &input("nil", Needs::default(), vec![]),
        Limits::default(),
        &mut interrupt,
    );
    let Outcome::Failed { reason, .. } = out else {
        panic!("{out:?}")
    };
    assert_eq!(reason, "timeout");
}

#[test]
fn a_run_that_never_ends_hits_the_nesting_limit_instead_of_crashing() {
    // A function applied to itself: no loop or recursion by name, but it never returns.
    let a = parse_action(r#"{:id :t/omega :fn (fn [r] ((fn [f] (f f)) (fn [f] (f f))))}"#).unwrap();
    let out = run(
        &a,
        &input("nil", Needs::default(), vec![]),
        Limits::default(),
        &mut never(),
    );
    let Outcome::Failed { reason, .. } = out else {
        panic!("{out:?}")
    };
    assert_eq!(reason, "limit");
}

#[test]
fn the_same_inputs_and_answers_give_the_same_result() {
    let a = parse_action(GEO_PLACE).unwrap();
    let answer = || Answer::Value(v(r#"[{:lat "53.3498" :lon "-6.2603"}]"#));
    let once = run(
        &a,
        &input(
            r#"{:q "Dublin"}"#,
            fetch_nominatim(),
            vec![(DUBLIN_REQUEST, answer())],
        ),
        Limits::default(),
        &mut never(),
    );
    let twice = run(
        &a,
        &input(
            r#"{:q "Dublin"}"#,
            fetch_nominatim(),
            vec![(DUBLIN_REQUEST, answer())],
        ),
        Limits::default(),
        &mut never(),
    );
    assert_eq!(once, twice);
}

#[test]
fn a_value_nested_without_end_is_stopped_before_it_can_crash_printing() {
    let a = parse_action(
        r#"{:id :t/deep :fn (fn [r] {:keep (reduce (fn [acc x] [acc]) [] (range 100000))})}"#,
    )
    .unwrap();
    let out = run(
        &a,
        &input("nil", Needs::default(), vec![]),
        Limits::default(),
        &mut never(),
    );
    let Outcome::Failed {
        reason, message, ..
    } = out
    else {
        panic!("{out:?}")
    };
    assert_eq!(reason, "limit");
    assert!(message.contains("nested"), "{message}");
}
