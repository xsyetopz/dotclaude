// SubagentStart: gives each subagent the project AI policy clause. A
// subagent does not see the SessionStart context, and a research subagent
// once fetched the code of a project whose policy forbids AI tools.

import { POLICY_CLAUSE } from "../../lib/guards/policy.mjs";
import { TERMS_OF_USE } from "../../lib/terms.mjs";

export const SUBAGENT_CONTEXT = `${TERMS_OF_USE}\n\n${POLICY_CLAUSE}`;

if (import.meta.main)
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SubagentStart",
        additionalContext: SUBAGENT_CONTEXT,
      },
    }),
  );
