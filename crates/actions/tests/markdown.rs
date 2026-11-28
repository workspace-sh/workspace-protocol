//! Markdown's placement (`docs/actions/in-files.md`), as written there.

use workspace_actions::markdown::{
    action_block, apply, escape_comment, kept_text, marker, read_doc, unescape_comment,
};
use workspace_actions::place::Update;
use workspace_actions::Value;
use workspace_edn::read;

const DOC: &str = r#"## Trip

Dublin: <!--[kept geo/place {:q "Dublin"} 2026-11-25T09:00Z]-->53.3498, -6.2603<!--[/kept]-->
Galway: <!--[kept geo/place {:q "Galway"}]-->not looked up yet<!--[/kept]-->

<!--action
{:id :geo/place :on :open :fresh "P1D"
 :needs {:fetch ["nominatim.openstreetmap.org"]}
 :fn (fn [{:keys [q]} env ctx] {:keep q})}
-->
"#;

#[test]
fn reads_the_actions_and_every_place() {
    let doc = read_doc(DOC);
    assert!(doc.problems.is_empty(), "{:?}", doc.problems);
    assert_eq!(doc.actions.len(), 1);
    assert_eq!(doc.actions[0].id, "geo/place");
    assert_eq!(doc.places.len(), 2);
    let dublin = &doc.places[0];
    assert_eq!(dublin.key, "m:0");
    assert_eq!(dublin.inputs, read(r#"{:q "Dublin"}"#).unwrap());
    assert_eq!(dublin.at.as_deref(), Some("2026-11-25T09:00:00Z"));
    assert_eq!(dublin.value, Value::Str("53.3498, -6.2603".into()));
    assert_eq!(
        doc.places[1].at, None,
        "a place that hasn't run has no time"
    );
}

#[test]
fn writes_a_value_back_and_touches_nothing_else() {
    let update = Update {
        key: "m:1".into(),
        action: "geo/place".into(),
        inputs: read(r#"{:q "Galway"}"#).unwrap(),
        at: "2026-11-27T10:00:00Z".into(),
        keep: read("[53.2707 -9.0568]").unwrap(),
    };
    let (out, skipped) = apply(DOC, &[update]);
    assert!(skipped.is_empty());
    assert_eq!(
        out,
        DOC.replace(
            r#"<!--[kept geo/place {:q "Galway"}]-->not looked up yet<!--[/kept]-->"#,
            r#"<!--[kept geo/place {:q "Galway"} 2026-11-27T10:00:00Z]-->53.2707, -9.0568<!--[/kept]-->"#,
        )
    );
}

#[test]
fn a_place_whose_inputs_changed_while_it_ran_is_left_alone() {
    let update = Update {
        key: "m:1".into(),
        action: "geo/place".into(),
        inputs: read(r#"{:q "Cork"}"#).unwrap(),
        at: "2026-11-27T10:00:00Z".into(),
        keep: Value::Str("x".into()),
    };
    let (out, skipped) = apply(DOC, &[update]);
    assert_eq!(out, DOC);
    assert_eq!(skipped, ["m:1"]);
}

#[test]
fn markers_inside_code_are_text_about_actions_not_actions() {
    let doc = read_doc(
        "Write `<!--[kept a/b]-->x<!--[/kept]-->` like this:\n\n```markdown\n<!--[kept a/b]-->x<!--[/kept]-->\n<!--action\n{:id :a/b :fn (fn [] {:keep 1})}\n-->\n```\n\nReal: <!--[kept a/b]-->y<!--[/kept]-->\n",
    );
    assert_eq!(doc.actions.len(), 0);
    assert_eq!(doc.places.len(), 1);
    assert_eq!(doc.places[0].value, Value::Str("y".into()));
}

#[test]
fn an_action_that_cant_be_read_is_a_problem_and_the_rest_still_reads() {
    let doc = read_doc("<!--action\n{:id \"no\"}\n-->\n<!--action\n{:id :a/b :fn (fn [] {:keep 1})}\n-->\nA <!--[kept a/b {:x]-->1<!--[/kept]--> B <!--[kept a/b]-->2<!--[/kept]-->");
    assert_eq!(doc.actions.len(), 1);
    assert_eq!(doc.places.len(), 1);
    assert_eq!(doc.problems.len(), 2);
}

#[test]
fn a_string_with_angle_brackets_cant_end_the_comment() {
    let edn = r#"{:id :t/x :fn (fn [] {:keep "a --> b <!-- c"})}"#;
    let block = action_block(edn).unwrap();
    assert_eq!(
        block.matches("-->").count(),
        1,
        "only the comment's own end: {block}"
    );
    assert!(!block[4..].contains("<!--"));
    let doc = read_doc(&block);
    assert_eq!(
        doc.actions[0].edn, edn,
        "and it reads back as it was written"
    );
    assert_eq!(unescape_comment(&escape_comment(edn).unwrap()), edn);
}

#[test]
fn a_comment_ender_outside_a_string_is_refused() {
    assert!(action_block("{:id :t/x :fn (fn [a-->b] {:keep 1})}").is_err());
}

#[test]
fn kept_text_is_what_a_person_would_write() {
    let t = |s: &str| kept_text(&read(s).unwrap());
    assert_eq!(t(r#""Total: £19,263""#), "Total: £19,263");
    assert_eq!(t("[53.3498 -6.2603]"), "53.3498, -6.2603");
    assert_eq!(t("42"), "42");
    assert_eq!(t("nil"), "");
    assert_eq!(t(r#""a < b & c""#), "a &lt; b &amp; c");
    assert_eq!(t("{:a 1}"), "{:a 1}");
    assert_eq!(
        marker("a/b", "", None, "x"),
        "<!--[kept a/b]-->x<!--[/kept]-->"
    );
}

#[test]
fn a_value_with_entities_reads_back_as_itself() {
    let doc = read_doc("<!--[kept a/b]-->a &lt; b &amp; c<!--[/kept]-->");
    assert_eq!(doc.places[0].value, Value::Str("a < b & c".into()));
}
