// Where Markdown (and TextBundle and TextPack) keeps an action and what it
// made (`docs/actions/in-files.md`):
//
//     Dublin: <!--[kept geo/place {:q "Dublin"} 2026-11-25T09:00Z]-->53.3498, -6.2603<!--[/kept]-->
//
//     <!--action
//     {:id :geo/place :on :open :fresh "P1D" …}
//     -->
//
// A kept marker may leave out its time: that's a place an action hasn't run
// for yet, as a person writes one.
import type { ActionsBinding } from "./binding.ts";

export interface ActionBlock {
    id: string;
    /** The action's EDN, with the comment's escapes undone. */
    edn: string;
}

export interface Kept {
    id: string;
    /** The action's inputs, as EDN. */
    inputs: string;
    /** When it last ran, as written, or null if it hasn't. */
    at: string | null;
    /** The kept text, as it is in the document. */
    value: string;
    /** Where the whole marker, from `<!--[kept` to `<!--[/kept]-->`, starts and ends. */
    start: number;
    end: number;
}

export interface Problem {
    /** What it's about: an action's id, or the start of the block that couldn't be read. */
    about: string;
    message: string;
}

export interface MarkdownActions {
    actions: Map<string, ActionBlock>;
    kept: Kept[];
    problems: Problem[];
}

const ACTION = /<!--action\s([\s\S]*?)-->/g;
const KEPT = /<!--\[kept (\S+?)(?: ([\s\S]*?))?\]-->([\s\S]*?)<!--\[\/kept\]-->/g;
const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/;

/** Every action and kept value in `text`. An action that can't be read is a problem, not a throw. */
export function readMarkdown(b: ActionsBinding, text: string): MarkdownActions {
    const actions = new Map<string, ActionBlock>();
    const problems: Problem[] = [];
    for (const m of text.matchAll(ACTION)) {
        const edn = unescapeComment(m[1] ?? "");
        try {
            const { id } = b.describe(edn);
            actions.set(id, { id, edn });
        } catch (e) {
            problems.push({ about: edn.trim().slice(0, 40), message: e instanceof Error ? e.message : String(e) });
        }
    }
    const kept: Kept[] = [];
    for (const m of text.matchAll(KEPT)) {
        const rest = (m[2] ?? "").trim();
        const last = rest.lastIndexOf(" ");
        const tail = last < 0 ? rest : rest.slice(last + 1);
        const timed = TIME.test(tail);
        kept.push({
            id: m[1] ?? "",
            inputs: (timed ? (last < 0 ? "" : rest.slice(0, last)) : rest).trim() || "nil",
            at: timed ? tail : null,
            value: m[3] ?? "",
            start: m.index,
            end: m.index + m[0].length,
        });
    }
    return { actions, kept, problems };
}

/** The marker for a kept value, as it's written back. */
export function keptMarker(k: Pick<Kept, "id" | "inputs">, at: string, value: string): string {
    return `<!--[kept ${k.id} ${k.inputs} ${at}]-->${value}<!--[/kept]-->`;
}

/**
 * `text` with each kept value replaced, or null for one whose marker has
 * changed since it was read (an edit landed meanwhile): that one is left as it is.
 */
export function writeKept(
    text: string,
    updates: { kept: Kept; at: string; value: string }[],
): { text: string; skipped: Kept[] } {
    const skipped: Kept[] = [];
    let out = text;
    for (const u of [...updates].sort((x, y) => y.kept.start - x.kept.start)) {
        const was = out.slice(u.kept.start, u.kept.end);
        if (!was.startsWith(`<!--[kept ${u.kept.id}`) || !was.endsWith("<!--[/kept]-->") || !was.includes(`]-->${u.kept.value}<!--[/kept]-->`)) {
            skipped.push(u.kept);
            continue;
        }
        out = out.slice(0, u.kept.start) + keptMarker(u.kept, u.at, u.value) + out.slice(u.kept.end);
    }
    return { text: out, skipped };
}

/**
 * A kept value as Markdown text. A string is itself, a number or a boolean
 * its digits or word, and a list of those its items joined by ", " (the
 * spec's `53.3498, -6.2603`). Anything else is its EDN. `<` is written as
 * `&lt;`, so a value never opens a tag or a comment.
 */
export function keptText(b: ActionsBinding, keepEdn: string): string {
    const v = JSON.parse(b.ednToJson(keepEdn)) as unknown;
    const scalar = (x: unknown): string | null =>
        typeof x === "string" ? x : typeof x === "number" || typeof x === "boolean" ? String(x) : x === null ? "" : null;
    let text = scalar(v);
    if (text === null && Array.isArray(v)) {
        const items = v.map(scalar);
        text = items.every((i) => i !== null) ? items.join(", ") : null;
    }
    return (text ?? keepEdn).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}

/**
 * Undo the escapes a writer puts in an action block so the EDN can't end
 * its comment: `\u003c` and `\u003e` inside a string are `<` and `>`.
 * A string's other escapes, and everything outside strings, are untouched.
 */
export function unescapeComment(edn: string): string {
    let out = "";
    let inString = false;
    for (let i = 0; i < edn.length; i++) {
        const c = edn[i];
        if (!inString) {
            if (c === "\"") inString = true;
            if (c === ";") {
                const nl = edn.indexOf("\n", i);
                const end = nl < 0 ? edn.length : nl;
                out += edn.slice(i, end);
                i = end - 1;
                continue;
            }
            out += c;
            continue;
        }
        if (c === "\"") {
            inString = false;
            out += c;
        } else if (c === "\\") {
            const code = edn.slice(i + 1, i + 6).toLowerCase();
            if (code === "u003c" || code === "u003e") {
                out += code === "u003c" ? "<" : ">";
                i += 5;
            } else {
                out += c + (edn[i + 1] ?? "");
                i += 1;
            }
        } else {
            out += c;
        }
    }
    return out;
}
