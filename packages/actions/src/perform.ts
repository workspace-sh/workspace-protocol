// How a host performs requests. A fetch goes to the engine's own client, so
// every platform sends the same bytes under the same rules (pacing, redirects,
// size). Files, the clock and the locale are the platform's. The engine has
// already refused anything outside what the action declares and the device
// grants, and it reads whatever comes back, so these only do the work.
import { opWithin, type ActionsBinding } from "./binding.ts";
import type { HttpDescription, Perform, Performed, Request, TableFiles } from "./run.ts";

export interface HostOptions {
    /** BCP 47 locale for `env/format`, e.g. "en-IE". */
    locale: string;
    /** ISO 4217 code for `(env/format :currency …)`, e.g. "EUR". */
    currency: string;
    /** The clock, for `env/now`. */
    now?: () => Date;
    /** Read a workspace file by its path relative to the document, as text. */
    readFile?: (path: string) => Promise<string>;
    /** Read a `.table` by its path relative to the document. */
    readTable?: (path: string) => Promise<TableFiles>;
    /** Carry a fetch some other way: for a test, or a platform that can't open a socket. */
    http?: (description: HttpDescription) => Promise<Performed>;
}

export function hostPerformer(b: ActionsBinding, o: HostOptions): Perform {
    return async (r: Request): Promise<Performed> => {
        switch (r.op) {
            case "fetch":
                if (o.http) return o.http(r.http);
                // A little longer than the fetch's own timeout, so the client's answer is the one that's heard.
                return opWithin<Performed>(b, "http", r.http, r.http.timeoutMs + 2_000);
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
