// A run to the end: run the action, perform the request it stops at, and run
// it again with every answer so far, until it finishes or fails. The answers
// it used are its run record.
import type { ActionsBinding } from "./binding.ts";

/** A request as the engine makes it, read as JSON (keywords become strings). */
export type Request =
    | { op: "fetch"; url: string; query?: Record<string, unknown> }
    | { op: "read"; path: string }
    | { op: "now" }
    | { op: "format"; as: string; value: unknown }
    | { op: "locate" }
    | { op: "ask"; question: string; choices?: unknown[] };

export type FailedReason = "offline" | "timeout" | "denied" | "error";

/** How the host performed a request. `value` is EDN text. */
export type Answer = { value: string } | { failed: FailedReason; message?: string };

export type Outcome =
    | {
          status: "done";
          /** EDN, if the action kept a value. */
          keep: string | null;
          /** EDN, if it showed one. */
          show: string | null;
          /** The run record: `[[request answer] …]` as EDN. */
          asked: string;
      }
    | {
          status: "failed";
          reason: string;
          message: string;
          suggestions: string[];
          asked: string;
      };

export interface RunOptions {
    /** The trigger's inputs, as EDN (`{:q "Dublin"}`). */
    request?: string;
    /** This run's context, as EDN. */
    ctx?: string;
    /** What this device grants the action. */
    granted: { fetch?: string[]; read?: string[]; locate?: boolean; ask?: boolean };
    /** The runner's timeout for the whole run, requests included. */
    timeoutMs: number;
    /** The most requests one run may make. */
    maxRequests?: number;
}

/** Perform one request. `edn` is the request exactly as the engine printed it. */
export type Perform = (request: Request, edn: string) => Promise<Answer>;

export async function runToEnd(
    b: ActionsBinding,
    action: string,
    options: RunOptions,
    perform: Perform,
): Promise<Outcome> {
    const deadline = Date.now() + options.timeoutMs;
    const answers: string[] = [];
    const granted = grantedEdn(b, options.granted);
    const maxRequests = options.maxRequests ?? 32;
    for (;;) {
        const input = `{:request ${options.request ?? "nil"} :ctx ${options.ctx ?? "nil"} :granted ${granted} :answers [${answers.join(" ")}]}`;
        const left = deadline - Date.now();
        const out = left > 0 ? await b.run(action, input, left) : timedOut(answers);
        const status = b.get(out, "status");
        const asked = b.get(out, "asked") ?? "[]";
        if (status === ":done") {
            return { status: "done", keep: b.get(out, "keep"), show: b.get(out, "show"), asked };
        }
        if (status === ":failed") {
            const o = JSON.parse(b.ednToJson(out)) as { reason: string; message: string; suggestions?: string[] };
            return { status: "failed", reason: o.reason, message: o.message, suggestions: o.suggestions ?? [], asked };
        }
        const requestEdn = b.get(out, "request");
        if (status !== ":needs" || requestEdn === null) {
            return { status: "failed", reason: "failed", message: `the engine answered ${out}`, suggestions: [], asked };
        }
        if (answers.length >= maxRequests) {
            return {
                status: "failed",
                reason: "limit",
                message: `it made more than ${maxRequests} requests`,
                suggestions: [],
                asked,
            };
        }
        const request = JSON.parse(b.ednToJson(requestEdn)) as Request;
        const answer = await withDeadline(perform(request, requestEdn), deadline);
        answers.push(`[${requestEdn} ${answerEdn(b, answer)}]`);
    }
}

function timedOut(answers: string[]): string {
    return `{:status :failed :reason :timeout :message "it took longer than its timeout" :asked [${answers.join(" ")}]}`;
}

async function withDeadline(p: Promise<Answer>, deadline: number): Promise<Answer> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<Answer>((resolve) => {
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

function answerEdn(b: ActionsBinding, a: Answer): string {
    if ("value" in a) return `{:value ${a.value}}`;
    return `{:failed :${a.failed} :message ${b.jsonToEdn(JSON.stringify(a.message ?? ""))}}`;
}

function grantedEdn(b: ActionsBinding, g: RunOptions["granted"]): string {
    return b.jsonToEdn(
        JSON.stringify({ fetch: g.fetch ?? [], read: g.read ?? [], locate: g.locate ?? false, ask: g.ask ?? false }),
    );
}
