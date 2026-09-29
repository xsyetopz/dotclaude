// Test action for the dispatcher: it fails, and the other actions still run.
import { run } from "../../../hooks/lib/_common.mjs";

run(() => {
  throw new Error("boom");
});
