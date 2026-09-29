// Test action for the dispatcher: it waits for `emits-now.mjs`, which comes
// later in the table, so it says "late" only when the actions run at the same
// time, and "serial" when the dispatcher runs them one after another.
import { emit, run } from "../../../hooks/lib/_common.mjs";

const NOW = Symbol.for("dotclaude.test.now");

run(async () => {
  for (let waited = 0; waited < 1000 && !globalThis[NOW]; waited += 10)
    await Bun.sleep(10);
  emit({ systemMessage: globalThis[NOW] ? "late" : "serial" });
});
