// Something happened to a document (it opened, a cell was edited, a file it
// reads changed): run what the engine says runs, and write what each run
// keeps back into the document. Each place is its own run with its own
// result, so one failure leaves the others alone and keeps its last value.
import { op, type ActionsBinding, type Needs } from "./binding.ts";
import { runToEnd, type Outcome, type Perform, type PlannedRun } from "./run.ts";

/** A document, as the format keeps it. A `.table` is refreshed one rows file at a time. */
export type Doc =
    | { format: "markdown" | "canvas"; text: string }
    | { format: "table"; schema: string; rows: string };

export type DocEvent = "open" | "tick" | { tap: string } | { edit: string; row?: string } | { change: string };

export interface RefreshOptions {
    event: DocEvent;
    now: Date;
    /** This member's IANA zone, for `:tz :local`. */
    zone: string | null;
    /** What the app knows about a run: its locale, the member, the device. Every run's `ctx` starts from it. */
    ctx?: Record<string, unknown>;
    /** What this device grants each action, by id. */
    grants: Record<string, Partial<Needs>>;
    perform: Perform;
    /** Each run's timeout. */
    timeoutMs: number;
}

export interface Problem {
    about: string;
    message: string;
}

export interface Ungranted extends Needs {
    action: string;
    /** The places waiting on it. */
    keys: string[];
}

export interface Held {
    key: string;
    action: string;
    why: string;
    until: string | null;
}

interface Planned {
    runs: PlannedRun[];
    held: Held[];
    ungranted: Ungranted[];
    problems: Problem[];
}

export interface Refreshed {
    /** The document with every kept value written back. The same object when nothing was. */
    doc: Doc;
    /** Each run and how it came out. */
    results: { run: PlannedRun; outcome: Outcome; record: string }[];
    /** Places whose value was made for inputs that changed while it ran: left as they were. */
    skipped: string[];
    held: Held[];
    /** What each action needs that this device hasn't granted: what the app asks about. */
    ungranted: Ungranted[];
    problems: Problem[];
}

export async function refresh(b: ActionsBinding, doc: Doc, o: RefreshOptions): Promise<Refreshed> {
    const now = o.now.toISOString();
    const planned = op<Planned>(b, "plan", { ...doc, event: o.event, now, zone: o.zone, ctx: o.ctx ?? {}, grants: o.grants });
    const results: Refreshed["results"] = [];
    const kept: { key: string; action: string; inputs: string; at: string; keepEdn: string }[] = [];
    for (const run of planned.runs) {
        const outcome = await runToEnd(b, run, { timeoutMs: o.timeoutMs }, o.perform);
        const { record } = op<{ record: string }>(b, "record", {
            action: run.action,
            key: run.key,
            input: run.input,
            at: now,
            slot: run.slot ?? undefined,
            outcome,
        });
        results.push({ run, outcome, record });
        if (outcome.status === "done" && outcome.keepEdn !== null) {
            kept.push({ key: run.key, action: run.action, inputs: run.inputs, at: now, keepEdn: outcome.keepEdn });
        }
    }
    let out = doc;
    let skipped: string[] = [];
    if (kept.length > 0) {
        const applied = op<{ text?: string; rows?: string; skipped: string[] }>(b, "apply", { ...doc, results: kept });
        skipped = applied.skipped;
        out = doc.format === "table" ? { ...doc, rows: applied.rows ?? doc.rows } : { ...doc, text: applied.text ?? doc.text };
    }
    return { doc: out, results, skipped, held: planned.held, ungranted: planned.ungranted, problems: planned.problems };
}
