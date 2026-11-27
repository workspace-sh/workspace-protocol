// A run to its end: the engine runs the action until it finishes or asks for
// something, the host performs that, and the engine runs again with every
// answer so far. The engine decides everything; the host only performs.
import { op, opWithin, type ActionsBinding } from "./binding.ts";

/** A fetch exactly as it goes on the wire; the engine's own client sends it (the `http` operation). */
export interface HttpDescription {
    method: string;
    url: string;
    headers: [string, string][];
    body: string | null;
    timeoutMs: number;
    maxBytes: number;
    maxRedirects: number;
    redirectHosts: string[];
}

/** A request, as the engine hands it to the host. */
export type Request =
    | { op: "fetch"; url: string; query?: Record<string, unknown>; /** The whole address, query included. */ href: string; http: HttpDescription }
    | { op: "read"; path: string }
    | { op: "now" }
    | { op: "format"; as: string; value: unknown }
    | { op: "locate" }
    | { op: "ask"; question: string; choices?: unknown[] };

export type FailedReason = "offline" | "timeout" | "denied" | "error";

/** A `.table`, as the host reads it for `env/read`: each table's schema and rows files, as text. */
export interface TableFiles {
    tables: { name: string; schema: string; rows: string[] }[];
}

/** What the host got for a request. The engine turns it into the answer the action is given. */
export type Performed =
    | { failed: FailedReason; message?: string }
    /** A fetch. */
    | { status: number; body: string }
    /** A file's text, the time, a formatted value. */
    | { text: string }
    | { table: TableFiles }
    /** Any JSON value: a place, what someone chose. */
    | { value: unknown };

export type Perform = (request: Request) => Promise<Performed>;

/** One run the engine planned (`plan`), as it gave it. */
export interface PlannedRun {
    key: string;
    action: string;
    edn: string;
    inputs: string;
    input: string;
    slot: string | null;
}

export type Outcome =
    | { status: "done"; keepEdn: string | null; showEdn: string | null; show: string | null; asked: string }
    | { status: "failed"; reason: string; message: string; suggestions: string[]; asked: string };

type Step = Outcome | { status: "needs"; requestEdn: string; request: Request; asked: string };

export interface RunOptions {
    /** The runner's timeout for the whole run, requests included. */
    timeoutMs: number;
    /** The most requests one run may make; the engine's default when left out. */
    maxRequests?: number;
}

export async function runToEnd(
    b: ActionsBinding,
    run: Pick<PlannedRun, "edn" | "input">,
    options: RunOptions,
    perform: Perform,
): Promise<Outcome> {
    const deadline = Date.now() + options.timeoutMs;
    const answers: [string, string][] = [];
    for (;;) {
        const left = deadline - Date.now();
        if (left <= 0) {
            return { status: "failed", reason: "timeout", message: "it took longer than its timeout", suggestions: [], asked: "[]" };
        }
        const step = await opWithin<Step>(
            b,
            "run",
            { edn: run.edn, input: run.input, answers, maxRequests: options.maxRequests },
            left,
        );
        if (step.status !== "needs") return step;
        const performed = await withDeadline(perform(step.request), deadline);
        const { answerEdn } = op<{ answerEdn: string }>(b, "answer", { requestEdn: step.requestEdn, ...performed });
        answers.push([step.requestEdn, answerEdn]);
    }
}

async function withDeadline(p: Promise<Performed>, deadline: number): Promise<Performed> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<Performed>((resolve) => {
        timer = setTimeout(
            () => resolve({ failed: "timeout", message: "the run's timeout passed while this was performed" }),
            Math.max(0, deadline - Date.now()),
        );
    });
    try {
        return await Promise.race([p.catch((e: unknown) => ({ failed: "error" as const, message: String(e) })), late]);
    } finally {
        clearTimeout(timer);
    }
}
