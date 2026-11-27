// The actions engine from Swift, over its C interface
// (`include/workspace_actions.h`). The engine decides everything about
// actions; an app performs what an action asks for (the network, a file, the
// clock, its locale, the screen) and passes the results back.
//
// To use it, link the static library `libworkspace_actions_ffi.a` and
// expose the header to Swift, through a module map or a bridging header.

import Foundation

public enum WorkspaceActions {
    /// The engine refused the input: the message says what was wrong with it.
    public struct Refused: Error, CustomStringConvertible {
        public let description: String
    }

    /// Run an operation now. For everything quick: reading a document,
    /// planning, answering, writing back. `timeoutMs` stops an operation
    /// that runs an action (`run`, `check`); 0 is no timeout.
    public static func call(_ op: String, _ input: [String: Any], timeoutMs: UInt32 = 0) throws -> [String: Any] {
        let json = try JSONSerialization.data(withJSONObject: input)
        let text = String(decoding: json, as: UTF8.self)
        guard let raw = workspace_actions_call(op, text, timeoutMs) else {
            throw Refused(description: "the engine returned nothing")
        }
        defer { workspace_actions_free(raw) }
        let out = try JSONSerialization.jsonObject(with: Data(bytes: raw, count: strlen(raw)))
        guard let object = out as? [String: Any] else {
            throw Refused(description: "the engine's answer wasn't an object")
        }
        if let message = object["error"] as? String {
            throw Refused(description: "actions \(op): \(message)")
        }
        return object
    }

    /// The same, off the calling thread: for `run` and `check`, which take
    /// as long as the action does.
    public static func callWithin(_ op: String, _ input: [String: Any], timeoutMs: UInt32) async throws -> [String: Any] {
        let json = try JSONSerialization.data(withJSONObject: input)
        let answer: Data = await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                let text = String(decoding: json, as: UTF8.self)
                guard let raw = workspace_actions_call(op, text, timeoutMs) else {
                    continuation.resume(returning: Data(#"{"error":"the engine returned nothing"}"#.utf8))
                    return
                }
                defer { workspace_actions_free(raw) }
                continuation.resume(returning: Data(bytes: raw, count: strlen(raw)))
            }
        }
        guard let object = try JSONSerialization.jsonObject(with: answer) as? [String: Any] else {
            throw Refused(description: "the engine's answer wasn't an object")
        }
        if let message = object["error"] as? String {
            throw Refused(description: "actions \(op): \(message)")
        }
        return object
    }

    /// What the app got for a request, for the engine to turn into the
    /// answer the action is given.
    public enum Performed {
        case failed(reason: String, message: String)
        /// A fetch.
        case response(status: Int, body: String)
        /// A file's text, the time, a formatted value.
        case text(String)
        /// Any JSON value: a place, what someone chose.
        case value(Any)

        var fields: [String: Any] {
            switch self {
            case let .failed(reason, message): return ["failed": reason, "message": message]
            case let .response(status, body): return ["status": status, "body": body]
            case let .text(text): return ["text": text]
            case let .value(value): return ["value": value]
            }
        }
    }

    /// Run one planned run to its end: the engine runs the action until it
    /// finishes or asks for something, `perform` does that, and the engine
    /// runs again with every answer so far. `run` is an entry of `plan`'s
    /// `runs`. Returns the outcome: `status` is `done` or `failed`.
    public static func runToEnd(
        _ run: [String: Any],
        timeoutMs: UInt32,
        perform: ([String: Any]) async -> Performed
    ) async throws -> [String: Any] {
        let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000)
        var answers: [[String]] = []
        while true {
            let left = deadline.timeIntervalSinceNow
            if left <= 0 {
                return ["status": "failed", "reason": "timeout", "message": "it took longer than its timeout", "suggestions": [String](), "asked": "[]"]
            }
            let step = try await callWithin(
                "run",
                ["edn": run["edn"] ?? "", "input": run["input"] ?? "{}", "answers": answers],
                timeoutMs: UInt32(max(1, left * 1000))
            )
            guard step["status"] as? String == "needs",
                  let requestEdn = step["requestEdn"] as? String,
                  let request = step["request"] as? [String: Any]
            else { return step }
            var result = await perform(request).fields
            result["requestEdn"] = requestEdn
            let answer = try call("answer", result)
            answers.append([requestEdn, answer["answerEdn"] as? String ?? ""])
        }
    }
}
