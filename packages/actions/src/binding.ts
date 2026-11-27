// The engine's native binding (`crates/actions-node`), as the host calls it.
// It's loaded by path, never imported, so a bundler leaves it alone.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export interface Described {
    id: string;
    on: "open" | "tap" | "edit" | "change" | "at" | "cron" | "none" | "unknown";
    fresh?: string | null;
    fetch: string[];
    read: string[];
    locate: boolean;
    ask: boolean;
}

export interface ActionsBinding {
    /** One run, resolving to the outcome as EDN. Never rejects. */
    run(action: string, input: string, timeoutMs: number): Promise<string>;
    /** Whether the action is due, as EDN (`{:due :now}` or `{:due :later …}`). */
    due(action: string, lastRun: string | null, now: string, localZone: string | null): string;
    describe(action: string): Described;
    /** The value at a keyword in an EDN map, as EDN, or null. */
    get(edn: string, key: string): string | null;
    jsonToEdn(json: string): string;
    ednToJson(edn: string): string;
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
