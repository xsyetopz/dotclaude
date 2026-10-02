// PostToolUseFailure: same ledger update as PostToolUse. The action reads
// hook_event_name to tell a failed run from a successful one.

export default (await import("../post-tool-use/record-edits-and-checks.mjs"))
  .default;
