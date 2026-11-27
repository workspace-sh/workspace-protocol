// How a host performs requests: the network, files, the clock and the
// locale, which a platform does better than the engine could. The engine has
// already refused anything outside what the action declares and the device
// grants, and it reads whatever comes back, so these only do the work.
import type { Perform, Performed, Request, TableFiles } from "./run.ts";

export interface HostOptions {
    /** BCP 47 locale for `env/format`, e.g. "en-IE". */
    locale: string;
    /** ISO 4217 code for `(env/format :currency …)`, e.g. "EUR". */
    currency: string;
    /** The clock, for `env/now`. */
    now?: () => Date;
    /** How long one fetch may take. */
    fetchTimeoutMs?: number;
    /** Read a workspace file by its path relative to the document, as text. */
    readFile?: (path: string) => Promise<string>;
    /** Read a `.table` by its path relative to the document. */
    readTable?: (path: string) => Promise<TableFiles>;
    /** The fetch to use; the global one by default. */
    fetch?: typeof fetch;
}

export function hostPerformer(o: HostOptions): Perform {
    return async (r: Request): Promise<Performed> => {
        switch (r.op) {
            case "fetch":
                return fetchText(r.href, o);
            case "now":
                return { text: (o.now ?? (() => new Date()))().toISOString() };
            case "format":
                return format(r.as, r.value, o);
            case "read":
                try {
                    if (/\.table$/i.test(r.path)) {
                        if (!o.readTable) return { failed: "denied", message: "this app can't read a table for an action yet" };
                        return { table: await o.readTable(r.path) };
                    }
                    if (!o.readFile) return { failed: "denied", message: "this app can't read other files for an action yet" };
                    return { text: await o.readFile(r.path) };
                } catch (e) {
                    return { failed: "error", message: e instanceof Error ? e.message : String(e) };
                }
            case "locate":
            case "ask":
                return { failed: "denied", message: `this app can't answer env/${r.op} yet` };
        }
    };
}

async function fetchText(href: string, o: HostOptions): Promise<Performed> {
    const host = new URL(href).host;
    try {
        const res = await (o.fetch ?? fetch)(href, {
            signal: AbortSignal.timeout(o.fetchTimeoutMs ?? 10_000),
            headers: { accept: "application/json" },
        });
        return { status: res.status, body: await res.text() };
    } catch (e) {
        const name = e instanceof Error ? e.name : "";
        if (name === "TimeoutError") return { failed: "timeout", message: `${host} didn't answer in time` };
        return { failed: "offline", message: `couldn't reach ${host}` };
    }
}

function format(as: string, value: unknown, o: HostOptions): Performed {
    try {
        if (as === "currency" && typeof value === "number") {
            return { text: new Intl.NumberFormat(o.locale, { style: "currency", currency: o.currency }).format(value) };
        }
        if (as === "number" && typeof value === "number") {
            return { text: new Intl.NumberFormat(o.locale).format(value) };
        }
        if (as === "date" && typeof value === "string") {
            const d = new Date(value);
            if (!Number.isNaN(d.getTime())) return { text: new Intl.DateTimeFormat(o.locale, { dateStyle: "medium" }).format(d) };
        }
    } catch (e) {
        return { failed: "error", message: e instanceof Error ? e.message : String(e) };
    }
    return { failed: "error", message: `can't format ${JSON.stringify(value)} as ${as}` };
}
