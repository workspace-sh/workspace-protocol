/* The actions engine (workspace-protocol, crates/actions) from C.
 *
 * One call: an operation's name and JSON text in, JSON text out. The
 * operations are describe, read, plan, run, answer, apply, record, check,
 * block, jsonToEdn and ednToJson; crates/actions/src/api.rs says what each
 * takes and gives.
 */
#ifndef WORKSPACE_ACTIONS_H
#define WORKSPACE_ACTIONS_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Run an operation. `op` and `input` are NUL-terminated UTF-8, and `input`
 * is JSON. `timeout_ms` stops an operation that runs an action (run, check)
 * after that long, failing it as "timeout"; 0 is no timeout.
 *
 * Returns NUL-terminated JSON, freed with workspace_actions_free. Never
 * NULL: a mistake in the input is {"error": "..."}. Keeps nothing between
 * calls, and may be called from any thread. */
char *workspace_actions_call(const char *op, const char *input, uint32_t timeout_ms);

/* Free what workspace_actions_call returned. NULL is ignored. */
void workspace_actions_free(char *text);

#ifdef __cplusplus
}
#endif

#endif
