// The engine, as a host calls it through its binding. Nothing here is a
// platform's own: Node loads its binding in `node.ts`, and an app on another
// platform passes its own (a native module over the C call).

/**
 * The engine, as its binding gives it: one call, an operation's name and
 * JSON text in, JSON text out (workspace-protocol's `crates/actions`,
 * `api.rs`). Everything about actions is decided in there; this package only
 * performs what an action asks for and passes the results back.
 */
export interface ActionsBinding {
    /** Run an operation now. For everything quick: reading, planning, answering, writing back. */
    call(op: string, input: string): string;
    /** Run an operation on a worker thread, stopped after `timeoutMs`: for `run` and `check`. */
    callWithin(op: string, input: string, timeoutMs: number): Promise<string>;
}

/** What an action may ask for, declared by it or granted by a device. */
export interface Needs {
    fetch: string[];
    read: string[];
    locate: boolean;
    ask: boolean;
}

export interface Described {
    id: string;
    on: "open" | "tap" | "edit" | "change" | "at" | "cron" | "none" | "unknown";
    /** The field, file or moment its trigger names, if it names one. */
    of: string | null;
    fresh: string | null;
    needs: Needs;
}

function result<T>(op: string, out: string): T {
    const parsed = JSON.parse(out) as T & { error?: string };
    if (typeof parsed.error === "string") throw new Error(`actions ${op}: ${parsed.error}`);
    return parsed;
}

/** Call an operation and read its answer. Throws with the engine's message when it refuses the input. */
export function op<T>(b: ActionsBinding, name: string, input: unknown): T {
    return result<T>(name, b.call(name, JSON.stringify(input)));
}

/** The same, for an operation that runs an action. */
export async function opWithin<T>(b: ActionsBinding, name: string, input: unknown, timeoutMs: number): Promise<T> {
    return result<T>(name, await b.callWithin(name, JSON.stringify(input), timeoutMs));
}

/** Read an action without running it. */
export function describe(b: ActionsBinding, edn: string): Described {
    return op<Described>(b, "describe", { edn });
}
