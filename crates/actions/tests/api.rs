//! The engine through its one call, as an app drives it: plan what runs,
//! run each to its end by answering what it asks, write the values back,
//! and keep a record that can be checked.

use serde_json::{json, Value as J};
use workspace_actions::api::call;

fn c(op: &str, input: J) -> J {
    let out: J = serde_json::from_str(&call(op, &input.to_string(), &mut || false)).unwrap();
    assert!(out.get("error").is_none(), "{op}: {out}");
    out
}

const TRIP: &str = r#"# Trip

Dublin: <!--[kept geo/place {:q "Dublin"}]-->not looked up yet<!--[/kept]-->
Total: <!--[kept trip/total {:items [14400 4863]} 2026-11-20T09:00:00Z]-->old<!--[/kept]-->

<!--action
{:id :geo/place :on :open :fresh "P1D"
 :needs {:fetch ["nominatim.openstreetmap.org"]}
 :fn (fn [{:keys [q]} env ctx]
       (let [r (first (env/fetch "https://nominatim.openstreetmap.org/search"
                                 {:q q :format "json" :limit 1}))]
         {:keep [(:lat r) (:lon r)]}))}
-->

<!--action
{:id :trip/total :on :open
 :fn (fn [{:keys [items]} env ctx]
       {:keep (str (env/format :currency (sum items)) " across " (count items))})}
-->
"#;

fn plan(grants: J) -> J {
    c(
        "plan",
        json!({ "format": "markdown", "text": TRIP, "event": "open", "now": "2026-11-27T10:00:00.250Z", "zone": "Europe/Madrid", "ctx": { "locale": "en-GB" }, "grants": grants }),
    )
}

#[test]
fn an_action_without_its_grant_waits_and_the_rest_run() {
    let p = plan(json!({}));
    assert_eq!(p["runs"].as_array().unwrap().len(), 1);
    assert_eq!(p["runs"][0]["action"], "trip/total");
    assert_eq!(
        p["ungranted"],
        json!([{ "action": "geo/place", "fetch": ["nominatim.openstreetmap.org"], "read": [], "locate": false, "ask": false, "keys": ["m:0"] }])
    );
}

/// Run to the end, answering each request from `answers` by its op.
fn finish(run: &J, answer: &dyn Fn(&J) -> J) -> J {
    let mut pairs: Vec<J> = Vec::new();
    loop {
        let out = c(
            "run",
            json!({ "edn": run["edn"], "input": run["input"], "answers": pairs }),
        );
        if out["status"] != "needs" {
            return out;
        }
        let mut result = answer(&out["request"]);
        result["requestEdn"] = out["requestEdn"].clone();
        let a = c("answer", result);
        pairs.push(json!([out["requestEdn"], a["answerEdn"]]));
    }
}

#[test]
fn open_runs_each_place_and_writes_its_value_back() {
    let p = plan(json!({ "geo/place": { "fetch": ["nominatim.openstreetmap.org"] } }));
    let runs = p["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 2);
    let mut results = Vec::new();
    let mut records = Vec::new();
    for run in runs {
        let out = finish(run, &|request| match request["op"].as_str().unwrap() {
            "fetch" => {
                assert_eq!(
                    request["href"],
                    "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=Dublin"
                );
                json!({ "status": 200, "body": r#"[{"lat":"53.3498","lon":"-6.2603"}]"# })
            }
            "format" => {
                assert_eq!(request["as"], "currency");
                json!({ "text": "£19,263.00" })
            }
            other => panic!("unexpected {other}"),
        });
        assert_eq!(out["status"], "done", "{out}");
        results.push(json!({ "key": run["key"], "action": run["action"], "inputs": run["inputs"], "at": "2026-11-27T10:00:00.250Z", "keepEdn": out["keepEdn"] }));
        records.push((run.clone(), out));
    }
    let applied = c(
        "apply",
        json!({ "format": "markdown", "text": TRIP, "results": results }),
    );
    assert_eq!(applied["skipped"], json!([]));
    let text = applied["text"].as_str().unwrap();
    assert!(text.contains(r#"<!--[kept geo/place {:q "Dublin"} 2026-11-27T10:00:00Z]-->53.3498, -6.2603<!--[/kept]-->"#), "{text}");
    assert!(text.contains(r#"<!--[kept trip/total {:items [14400 4863]} 2026-11-27T10:00:00Z]-->£19,263.00 across 2<!--[/kept]-->"#), "{text}");

    // Opened again a minute later: the place is fresh and held back, the total runs again.
    let again = c(
        "plan",
        json!({ "format": "markdown", "text": text, "event": "open", "now": "2026-11-27T10:01:00Z", "grants": { "geo/place": { "fetch": ["nominatim.openstreetmap.org"] } } }),
    );
    assert_eq!(again["runs"].as_array().unwrap().len(), 1);
    assert_eq!(again["held"][0]["key"], "m:0");
    assert_eq!(again["held"][0]["until"], "2026-11-28T10:00:00Z");

    // Each run's record checks out from its own answers, and not once it's tampered with.
    for (run, out) in &records {
        let rec = c(
            "record",
            json!({ "action": run["action"], "key": run["key"], "input": run["input"], "at": "2026-11-27T10:00:00Z", "outcome": out }),
        );
        let record = rec["record"].as_str().unwrap();
        assert_eq!(
            c("check", json!({ "edn": run["edn"], "record": record }))["ok"],
            true
        );
        // A result the answers don't lead to is caught.
        let forged = record.replace(":result {:keep", ":result {:show");
        assert_ne!(forged, record);
        assert_eq!(
            c("check", json!({ "edn": run["edn"], "record": forged }))["ok"],
            false
        );
    }
}

#[test]
fn a_failed_request_fails_the_run_and_keeps_nothing() {
    let p = plan(json!({ "geo/place": { "fetch": ["nominatim.openstreetmap.org"] } }));
    let run = &p["runs"][0];
    let out = finish(
        run,
        &|_| json!({ "failed": "offline", "message": "no network" }),
    );
    assert_eq!(out["status"], "failed");
    assert_eq!(out["reason"], "offline");
    let out = finish(run, &|_| json!({ "status": 503, "body": "" }));
    assert_eq!(out["reason"], "error");
    assert_eq!(out["message"], "nominatim.openstreetmap.org answered 503");
}

#[test]
fn a_run_that_keeps_asking_is_stopped() {
    let edn = r#"{:id :t/loop :needs {:fetch ["a.example"]} :fn (fn [r env ctx] {:keep (map (fn [n] (env/fetch "https://a.example/" {:n n})) (range 100))})}"#;
    let mut pairs: Vec<J> = Vec::new();
    let out = loop {
        let out = c(
            "run",
            json!({ "edn": edn, "input": r#"{:granted {:fetch ["a.example"]}}"#, "answers": pairs, "maxRequests": 5 }),
        );
        if out["status"] != "needs" {
            break out;
        }
        let a = c(
            "answer",
            json!({ "requestEdn": out["requestEdn"], "value": 1 }),
        );
        pairs.push(json!([out["requestEdn"], a["answerEdn"]]));
    };
    assert_eq!(out["reason"], "limit");
    assert_eq!(pairs.len(), 5);
}

const SCHEMA: &str = r#"{"fields":[{"name":"isbn","type":"string"},{"name":"cover","type":"string","x-action":"books/cover"}],
"x-actions":{"books/cover":"{:id :books/cover :on [:edit \"isbn\"] :fresh \"P30D\" :fn (fn [{:keys [isbn]}] {:keep (str \"https://covers.example/\" isbn \".jpg\")})}"}}"#;

#[test]
fn a_table_runs_only_the_rows_whose_watched_cell_changed() {
    let rows = concat!(
        r#"{"id":"r1","isbn":"111","cover":"https://covers.example/111.jpg","x-kept":{"cover":{"action":"books/cover","at":"2026-11-26T09:00:00Z","from":{"isbn":"111"}}}}"#,
        "\n",
        r#"{"id":"r2","isbn":"999","cover":"https://covers.example/222.jpg","x-kept":{"cover":{"action":"books/cover","at":"2026-11-26T09:00:00Z","from":{"isbn":"222"}}}}"#,
        "\n",
        r#"{"id":"r3","isbn":"333"}"#,
        "\n",
        r#"{"id":"r4"}"#,
        "\n",
    );
    let table = |event: J| {
        c(
            "plan",
            json!({ "format": "table", "schema": SCHEMA, "rows": rows, "event": event, "now": "2026-11-27T10:00:00Z" }),
        )
    };
    let keys = |p: &J| {
        p["runs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["key"].as_str().unwrap().to_string())
            .collect::<Vec<_>>()
    };
    // On open: r2 was edited somewhere since its cover was made, r3 never had one; r1 is as it was, r4 has no ISBN.
    assert_eq!(keys(&table(json!("open"))), ["r:r2:cover", "r:r3:cover"]);
    // An edit to one row runs that row alone, fresh or not.
    assert_eq!(
        keys(&table(json!({ "edit": "isbn", "row": "r2" }))),
        ["r:r2:cover"]
    );
    assert_eq!(
        keys(&table(json!({ "edit": "title", "row": "r2" }))),
        Vec::<String>::new()
    );

    let p = table(json!("open"));
    let mut results = Vec::new();
    for run in p["runs"].as_array().unwrap() {
        let out = c("run", json!({ "edn": run["edn"], "input": run["input"] }));
        results.push(json!({ "key": run["key"], "action": run["action"], "inputs": run["inputs"], "at": "2026-11-27T10:00:00Z", "keepEdn": out["keepEdn"] }));
    }
    let applied = c(
        "apply",
        json!({ "format": "table", "schema": SCHEMA, "rows": rows, "results": results }),
    );
    let after = applied["rows"].as_str().unwrap();
    assert!(after.contains(r#"{"id":"r3","isbn":"333","cover":"https://covers.example/333.jpg","x-kept":{"cover":{"action":"books/cover","at":"2026-11-27T10:00:00Z","from":{"isbn":"333"}}}}"#), "{after}");
    assert!(after.contains(r#""cover":"https://covers.example/999.jpg""#));
    assert_eq!(
        after.lines().next(),
        rows.lines().next(),
        "an untouched row is byte for byte the same"
    );
    // And now nothing is due.
    let settled = c(
        "plan",
        json!({ "format": "table", "schema": SCHEMA, "rows": after, "event": "open", "now": "2026-11-27T10:05:00Z" }),
    );
    assert_eq!(settled["runs"], json!([]));
}

#[test]
fn a_change_to_a_file_runs_the_canvas_node_that_reads_it() {
    let canvas = r#"{"nodes":[{"id":"total","type":"text","text":"Total: ?","x-action":"canvas/total"}],
"x-actions":{"canvas/total":"{:id :canvas/total :on [:change \"household-budget.table\"] :needs {:read [\"household-budget.table\"]} :fn (fn [_ env ctx] (let [t (env/read \"household-budget.table\")] {:keep (str \"Total: \" (sum (map :amount (:rows t))))}))}"}}"#;
    let grants = json!({ "canvas/total": { "read": ["household-budget.table"] } });
    let on = |event: J| {
        c(
            "plan",
            json!({ "format": "canvas", "text": canvas, "event": event, "now": "2026-11-27T10:00:00Z", "grants": grants }),
        )
    };
    assert_eq!(on(json!("open"))["runs"], json!([]));
    assert_eq!(on(json!({ "change": "other.table" }))["runs"], json!([]));
    let p = on(json!({ "change": "household-budget.table" }));
    let run = &p["runs"][0];
    let out = finish(run, &|request| {
        assert_eq!(request["op"], "read");
        json!({ "table": { "tables": [{ "name": "ledger", "schema": r#"{"fields":[{"name":"item"},{"name":"amount"}]}"#,
            "rows": ["{\"id\":\"a\",\"item\":\"Rent\",\"amount\":-1450}\n{\"id\":\"b\",\"item\":\"Salary\",\"amount\":3600}\n"] }] } })
    });
    assert_eq!(out["keepEdn"], "\"Total: 2150\"", "{out}");
    let applied = c(
        "apply",
        json!({ "format": "canvas", "text": canvas, "results": [{ "key": run["key"], "action": run["action"], "inputs": run["inputs"], "at": "2026-11-27T10:00:00Z", "keepEdn": out["keepEdn"] }] }),
    );
    assert!(applied["text"].as_str().unwrap().contains(r#""text":"Total: 2150","x-action":"canvas/total","x-kept":{"action":"canvas/total","at":"2026-11-27T10:00:00Z"}"#), "{applied}");
}

#[test]
fn a_mistake_is_an_error_not_a_crash() {
    for (op, input) in [
        ("nope", "{}"),
        ("plan", "not json"),
        ("plan", "{}"),
        ("run", r#"{"edn":"("}"#),
        ("describe", r#"{"edn":"{:id 1}"}"#),
    ] {
        let out: J = serde_json::from_str(&call(op, input, &mut || false)).unwrap();
        assert!(out["error"].is_string(), "{op} {input}: {out}");
    }
}
