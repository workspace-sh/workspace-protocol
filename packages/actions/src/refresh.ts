// Refreshing a Markdown document's kept values when it opens: every kept
// value whose action runs on `:open`, or on a clock, and is due, is run
// again and written back. Each one is its own run with its own result, so
// one failure leaves the others alone and keeps its own last value.
import type { ActionsBinding, Described } from "./binding.ts";
import { keptText, readMarkdown, writeKept, type Kept, type Problem } from "./markdown.ts";
import { runToEnd, type Outcome, type Perform } from "./run.ts";

export interface Grants {
    /** What this device grants an action, by its id. */
    (action: Described): { fetch: string[]; read: string[]; locate: boolean; ask: boolean };
}

export interface RefreshOptions {
    now: Date;
    /** This member's IANA zone, for `:tz :local`. */
    localZone: string | null;
    grants: Grants;
    perform: Perform;
    /** Each run's timeout. */
    timeoutMs: number;
}

export type KeptResult =
    | { kept: Kept; action: Described; ran: true; outcome: Outcome }
    | { kept: Kept; action: Described | null; ran: false; why: string };

export interface Refreshed {
    /** The document with every value that ran written back. Unchanged when none did. */
    text: string;
    results: KeptResult[];
    problems: Problem[];
    /** What each action needs that this device hasn't granted, by id: what the app asks about. */
    ungranted: Map<string, { action: Described; fetch: string[]; read: string[] }>;
}

/** The marker's time, as the run record writes it: to the second, in UTC. */
export function markerTime(d: Date): string {
    return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function refreshMarkdown(b: ActionsBinding, text: string, o: RefreshOptions): Promise<Refreshed> {
    const doc = readMarkdown(b, text);
    const results: KeptResult[] = [];
    const ungranted = new Map<string, { action: Described; fetch: string[]; read: string[] }>();
    const updates: { kept: Kept; at: string; value: string }[] = [];
    const now = markerTime(o.now);

    for (const kept of doc.kept) {
        const block = doc.actions.get(kept.id);
        if (!block) {
            results.push({ kept, action: null, ran: false, why: `no action ${kept.id} in this document` });
            continue;
        }
        const action = b.describe(block.edn);
        if (!["open", "at", "cron"].includes(action.on)) {
            results.push({ kept, action, ran: false, why: `it runs on ${action.on}, not when the document opens` });
            continue;
        }
        const granted = o.grants(action);
        const missing = {
            fetch: action.fetch.filter((h) => !granted.fetch.includes(h)),
            read: action.read.filter((p) => !granted.read.includes(p)),
        };
        if (missing.fetch.length || missing.read.length) {
            ungranted.set(action.id, { action, ...missing });
            results.push({ kept, action, ran: false, why: "this device hasn't granted what it needs" });
            continue;
        }
        const due = b.get(b.due(block.edn, kept.at, now, o.localZone), "due");
        if (due !== ":now") {
            results.push({ kept, action, ran: false, why: "it isn't due" });
            continue;
        }
        const outcome = await runToEnd(b, block.edn, { request: kept.inputs, granted, timeoutMs: o.timeoutMs }, o.perform);
        results.push({ kept, action, ran: true, outcome });
        if (outcome.status === "done" && outcome.keep !== null) {
            updates.push({ kept, at: now, value: keptText(b, outcome.keep) });
        }
    }
    const written = updates.length ? writeKept(text, updates).text : text;
    return { text: written, results, problems: doc.problems, ungranted };
}
