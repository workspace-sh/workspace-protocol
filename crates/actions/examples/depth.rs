// Measures how deep a run can nest on a thread of a given stack size.
use workspace_actions::{parse_action, run, Input, Limits, Needs, Value};
fn main() {
    let a: Vec<usize> = std::env::args()
        .skip(1)
        .map(|x| x.parse().unwrap())
        .collect();
    let (depth, stack_kb) = (a[0], a[1]);
    let r = std::thread::Builder::new()
        .stack_size(stack_kb * 1024)
        .spawn(move || {
            let action =
                parse_action(r#"{:id :t/omega :fn (fn [r] ((fn [f] (f f)) (fn [f] (f f))))}"#)
                    .unwrap();
            let input = Input {
                request: Value::Nil,
                ctx: Value::Nil,
                granted: Needs::default(),
                answers: vec![],
            };
            let out = run(
                &action,
                &input,
                Limits {
                    stack_bytes: depth * 1024,
                    max_bytes: None,
                },
                &mut || false,
            );
            format!("{:?}", out).chars().take(60).collect::<String>()
        })
        .unwrap()
        .join()
        .unwrap();
    println!("{r}");
}
