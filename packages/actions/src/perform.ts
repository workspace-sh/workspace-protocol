// How a host performs requests. The engine has already refused anything
// outside what the action declares and the device grants, so these only do
// the work. A request this host can't do is answered as `:denied`.
import type { ActionsBinding } from "./binding.ts";
import type { Answer, Perform, Request } from "./run.ts";

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
    /** The fetch to use; the global one by default. */
    fetch?: typeof fetch;
}

export function hostPerformer(b: ActionsBinding, o: HostOptions): Perform {
    const edn = (v: unknown) => b.jsonToEdn(JSON.stringify(v));
    return async (r: Request): Promise<Answer> => {
        switch (r.op) {
            case "fetch":
                return fetchJson(b, r, o);
            case "now":
                return { value: edn((o.now ?? (() => new Date()))().toISOString()) };
            case "format":
                return format(r.as, r.value, o, edn);
            case "read": {
                if (!o.readFile) return { failed: "denied", message: "this app can't read other files for an action yet" };
                if (!/\.(md|markdown|txt)$/i.test(r.path)) {
                    return { failed: "denied", message: `this app can't read ${r.path} for an action yet: only Markdown and plain text` };
                }
                try {
                    return { value: edn(await o.readFile(r.path)) };
                } catch (e) {
                    return { failed: "error", message: e instanceof Error ? e.message : String(e) };
                }
            }
            case "locate":
            case "ask":
                return { failed: "denied", message: `this app can't answer env/${r.op} yet` };
        }
    };
}

async function fetchJson(b: ActionsBinding, r: { url: string; query?: Record<string, unknown> }, o: HostOptions): Promise<Answer> {
    const url = new URL(r.url);
    for (const [k, v] of Object.entries(r.query ?? {})) url.searchParams.set(k, String(v));
    let res: Response;
    try {
        res = await (o.fetch ?? fetch)(url, {
            signal: AbortSignal.timeout(o.fetchTimeoutMs ?? 10_000),
            headers: { accept: "application/json" },
        });
    } catch (e) {
        const name = e instanceof Error ? e.name : "";
        if (name === "TimeoutError") return { failed: "timeout", message: `${url.host} didn't answer in time` };
        return { failed: "offline", message: `couldn't reach ${url.host}` };
    }
    if (!res.ok) return { failed: "error", message: `${url.host} answered ${res.status}` };
    const body = await res.text();
    if ((res.headers.get("content-type") ?? "").includes("json")) {
        try {
            return { value: b.jsonToEdn(body) };
        } catch {
            return { failed: "error", message: `${url.host} sent JSON that couldn't be read` };
        }
    }
    return { value: b.jsonToEdn(JSON.stringify(body)) };
}

function format(as: string, value: unknown, o: HostOptions, edn: (v: unknown) => string): Answer {
    try {
        if (as === "currency" && typeof value === "number") {
            return { value: edn(new Intl.NumberFormat(o.locale, { style: "currency", currency: o.currency }).format(value)) };
        }
        if (as === "number" && typeof value === "number") {
            return { value: edn(new Intl.NumberFormat(o.locale).format(value)) };
        }
        if (as === "date" && typeof value === "string") {
            const d = new Date(value);
            if (!Number.isNaN(d.getTime())) return { value: edn(new Intl.DateTimeFormat(o.locale, { dateStyle: "medium" }).format(d)) };
        }
    } catch (e) {
        return { failed: "error", message: e instanceof Error ? e.message : String(e) };
    }
    return { failed: "error", message: `can't format ${JSON.stringify(value)} as ${as}` };
}
