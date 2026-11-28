/* The engine from C, as an app that isn't written in Rust uses it. */
#include <stdio.h>
#include <string.h>
#include "workspace_actions.h"

static int expect(const char *what, const char *op, const char *input, uint32_t timeout, const char *wanted) {
    char *out = workspace_actions_call(op, input, timeout);
    int ok = strstr(out, wanted) != NULL;
    if (!ok) fprintf(stderr, "%s: wanted %s in %s\n", what, wanted, out);
    workspace_actions_free(out);
    return ok ? 0 : 1;
}

int main(void) {
    int failed = 0;
    failed += expect("describe", "describe",
        "{\"edn\":\"{:id :t/x :on :open :fn (fn [r] {:keep 1})}\"}", 0, "\"id\":\"t/x\"");
    failed += expect("run", "run",
        "{\"edn\":\"{:id :t/x :fn (fn [r] {:keep (+ 1 2)})}\",\"input\":\"{}\"}", 1000, "\"keepEdn\":\"3\"");
    failed += expect("a run past its timeout", "run",
        "{\"edn\":\"{:id :t/x :fn (fn [r] {:keep (reduce + 0 (map (fn [n] (reduce + 0 (range 1000))) (range 100000000)))})}\",\"input\":\"{}\"}",
        100, "\"status\":\"failed\"");
    failed += expect("a mistake", "nope", "{}", 0, "\"error\"");
    failed += expect("NULL input", "plan", NULL, 0, "\"error\"");
    workspace_actions_free(NULL);
    if (failed == 0) puts("ok");
    return failed;
}
