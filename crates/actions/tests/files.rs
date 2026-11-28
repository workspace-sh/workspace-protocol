//! JSON Canvas and `.table` placement (`docs/actions/in-files.md`): what is
//! read, and that writing a value changes nothing else in the file.

use workspace_actions::place::Update;
use workspace_actions::{canvas, table, Value};
use workspace_edn::{print, read};

const TOTAL: &str = r#"{:id :canvas/total :on [:change \"household-budget.table\"] :needs {:read [\"household-budget.table\"]} :fn (fn [_ env ctx] {:keep \"x\"})}"#;

fn canvas_text() -> String {
    // Laid out as Obsidian writes a canvas: tabs, one node to a line.
    format!(
        "{{\n\t\"nodes\":[\n\t\t{{\"id\":\"src\",\"type\":\"file\",\"file\":\"household-budget.table\",\"x\":0,\"y\":0,\"width\":300,\"height\":200}},\n\t\t{{\"id\":\"total\",\"type\":\"text\",\"text\":\"Total: ?\",\"x\":400,\"y\":0,\"width\":250,\"height\":60,\"x-action\":\"canvas/total\"}}\n\t],\n\t\"edges\":[\n\t\t{{\"id\":\"e1\",\"fromNode\":\"src\",\"toNode\":\"total\"}}\n\t],\n\t\"x-actions\":{{\"canvas/total\":\"{TOTAL}\"}}\n}}"
    )
}

#[test]
fn a_canvas_node_is_a_place_and_its_text_the_value() {
    let doc = canvas::read_doc(&canvas_text());
    assert!(doc.problems.is_empty(), "{:?}", doc.problems);
    assert_eq!(doc.actions[0].id, "canvas/total");
    assert_eq!(doc.places.len(), 1);
    assert_eq!(doc.places[0].key, "n:total");
    assert_eq!(doc.places[0].value, Value::Str("Total: ?".into()));
    assert_eq!(doc.places[0].at, None);
}

#[test]
fn writing_a_canvas_value_changes_only_that_nodes_text_and_record() {
    let before = canvas_text();
    let (after, skipped) = canvas::apply(
        &before,
        &[Update {
            key: "n:total".into(),
            action: "canvas/total".into(),
            inputs: Value::Nil,
            at: "2026-11-27T10:00:00Z".into(),
            keep: Value::Str("Total: £19,263".into()),
        }],
    );
    assert!(skipped.is_empty());
    assert_eq!(
        after,
        before.replace(
            r#""text":"Total: ?","x":400,"y":0,"width":250,"height":60,"x-action":"canvas/total"}"#,
            r#""text":"Total: £19,263","x":400,"y":0,"width":250,"height":60,"x-action":"canvas/total","x-kept":{"action":"canvas/total","at":"2026-11-27T10:00:00Z"}}"#,
        )
    );
    let again = canvas::read_doc(&after);
    assert_eq!(again.places[0].at.as_deref(), Some("2026-11-27T10:00:00Z"));
    assert_eq!(again.places[0].value, Value::Str("Total: £19,263".into()));
}

#[test]
fn a_node_can_hold_its_action_itself_and_only_text_nodes_keep() {
    let text = format!(
        r#"{{"nodes":[{{"id":"a","type":"text","text":"","x-action":"{TOTAL}"}},{{"id":"b","type":"file","file":"x.md","x-action":"canvas/total"}}]}}"#
    );
    let doc = canvas::read_doc(&text);
    assert_eq!(doc.actions.len(), 1);
    assert_eq!(doc.places.len(), 1);
    assert_eq!(doc.problems.len(), 1);
    assert_eq!(doc.problems[0].about, "n:b");
}

const SCHEMA: &str = r#"{
  "fields": [
    { "name": "title", "type": "string" },
    { "name": "isbn", "type": "string" },
    { "name": "cover", "type": "string", "x-action": "books/cover" }
  ],
  "x-actions": { "books/cover": "{:id :books/cover :on [:edit \"isbn\"] :fresh \"P30D\" :fn (fn [{:keys [isbn]}] {:keep (str \"https://covers.openlibrary.org/b/isbn/\" isbn \"-M.jpg\")})}" }
}"#;

const ROWS: &str = "{\"id\":\"r1\",\"title\":\"Dune\",\"isbn\":\"9780441013593\",\"cover\":\"https://covers.openlibrary.org/b/isbn/9780441013593-M.jpg\",\"x-kept\":{\"cover\":{\"action\":\"books/cover\",\"at\":\"2026-11-25T09:00:00Z\",\"from\":{\"isbn\":\"9780441013593\"}}}}\n{\"id\":\"r2\",\"title\":\"Piranesi\",\"isbn\":\"9781635575637\"}\n";

#[test]
fn each_row_is_a_place_for_the_field_an_action_fills() {
    let doc = table::read_doc(SCHEMA, ROWS);
    assert!(doc.problems.is_empty(), "{:?}", doc.problems);
    assert_eq!(doc.places.len(), 2);
    let dune = &doc.places[0];
    assert_eq!(dune.key, "r:r1:cover");
    assert_eq!(
        print(&dune.inputs),
        r#"{:id "r1" :isbn "9780441013593" :title "Dune"}"#
    );
    assert_eq!(dune.from, Some(read(r#"{:isbn "9780441013593"}"#).unwrap()));
    assert_eq!(dune.at.as_deref(), Some("2026-11-25T09:00:00Z"));
    let piranesi = &doc.places[1];
    assert_eq!(piranesi.value, Value::Nil);
    assert_eq!(
        piranesi.from,
        Some(Value::Nil),
        "never run: made from nothing"
    );
}

#[test]
fn writing_a_cell_changes_only_that_row() {
    let doc = table::read_doc(SCHEMA, ROWS);
    let (after, skipped) = table::apply(
        SCHEMA,
        ROWS,
        &[Update {
            key: "r:r2:cover".into(),
            action: "books/cover".into(),
            inputs: doc.places[1].inputs.clone(),
            at: "2026-11-27T10:00:00Z".into(),
            keep: Value::Str("https://covers.openlibrary.org/b/isbn/9781635575637-M.jpg".into()),
        }],
    );
    assert!(skipped.is_empty());
    let (first, _) = ROWS.split_once('\n').unwrap();
    assert_eq!(
        after,
        format!(
            "{first}\n{}\n",
            r#"{"id":"r2","title":"Piranesi","isbn":"9781635575637","cover":"https://covers.openlibrary.org/b/isbn/9781635575637-M.jpg","x-kept":{"cover":{"action":"books/cover","at":"2026-11-27T10:00:00Z","from":{"isbn":"9781635575637"}}}}"#
        )
    );
}

#[test]
fn a_row_edited_while_the_action_ran_is_left_alone() {
    let (after, skipped) = table::apply(
        SCHEMA,
        ROWS,
        &[Update {
            key: "r:r2:cover".into(),
            action: "books/cover".into(),
            inputs: read(r#"{:id "r2" :title "Piranesi" :isbn "000"}"#).unwrap(),
            at: "2026-11-27T10:00:00Z".into(),
            keep: Value::Str("x".into()),
        }],
    );
    assert_eq!(after, ROWS);
    assert_eq!(skipped, ["r:r2:cover"]);
}
