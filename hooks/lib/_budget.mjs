// dotclaude's bounds. A test keeps the copies of these numbers in step with
// this file.

/**
 * Lines of runtime JavaScript for the whole 0.20.0 release: all `.mjs` files
 * under `hooks/`, `status-line/`, `skills/`, and `plugins/`.
 * `tests/budget.test.mjs` fails above this number.
 */
export const RUNTIME_JS_LINES = 3000;

/** Time that one Betterleaks scan can take. A scan takes about 30 ms. */
export const SECRET_SCAN_TIMEOUT_MS = 8000;

/** Output size at which the secret scan stops. Larger output goes unscanned. */
export const SECRET_SCAN_MAX_BYTES = 64 * 1024 * 1024;

/** Characters of a command part that an ask reason shows. */
export const COMMAND_PART_CHARS = 80;
