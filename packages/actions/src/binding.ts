// The engine's native binding (`crates/actions-node`), as the host calls it.
// It's loaded by path, never imported, so a bundler leaves it alone.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

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

/** The file name the build gives the binding for this machine. */
export function bindingFile(platform: string = process.platform, arch: string = process.arch): string {
    return `actions.${platform}-${arch}.node`;
}

/** Load the binding from `path`, a `.node` file. Throws, saying where it looked, if it can't. */
export function loadBinding(path: string): ActionsBinding {
    try {
        return createRequire(import.meta.url)(path) as ActionsBinding;
    } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        throw new Error(`the actions engine didn't load from ${path}: ${why}`);
    }
}

/**
 * Load the binding built for this machine: beside this package's source in a
 * checkout (`crates/actions-node/native/`), or in `native/` beside a bundle
 * built from it (`crates/actions-node/build-native.sh <dir>` puts it there).
 * Null when neither has one.
 */
export function findBinding(from: string | URL = import.meta.url): ActionsBinding | null {
    const name = bindingFile();
    const candidates = [new URL(`../../../crates/actions-node/native/${name}`, from), new URL(`./native/${name}`, from)];
    const found = candidates.find((f) => existsSync(f));
    return found ? loadBinding(fileURLToPath(found)) : null;
}
