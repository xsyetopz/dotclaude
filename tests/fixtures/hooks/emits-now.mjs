// Test action for the dispatcher: it emits at once, see `emits-late.mjs`.
import { emit, run } from "../../../hooks/lib/_common.mjs";

run(() => {
  globalThis[Symbol.for("dotclaude.test.now")] = true;
  emit({ systemMessage: "now" });
});
