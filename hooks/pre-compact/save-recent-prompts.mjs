// PreCompact: save the user's recent prompts before compaction so the
// SessionStart(compact) hook can restore them verbatim. It also forgets the
// full reads, because the summary drops their content. A subagent keeps no
// prompts, because only the main conversation restores them.

import { option } from "../lib/_core.mjs";
import { load, save, withLedger } from "../lib/_ledger.mjs";
import { isSubagent, LAST_PROMPT_CHARS } from "../lib/_transcript-parse.mjs";

export default async (io, data) => {
  const sub = isSubagent(data);
  // With no `agent_id`, the subagent's ledger is unknown. Leave all state.
  if (sub && !data.agent_id) return null;
  const prompts =
    !sub && option(io.env, "context_compact_carryover")
      ? await io.session.recentPrompts(5, LAST_PROMPT_CHARS)
      : [];
  await withLedger(io, data.session_id, data.agent_id ?? null, async () => {
    const state = await load(io, data.session_id, data.agent_id ?? null);
    const hadReads = Boolean(state.reads);
    delete state.reads;
    if (prompts.length) state.prompts = prompts;
    if (prompts.length || hadReads)
      await save(io, data.session_id, data.agent_id ?? null, state);
  });
  return null;
};
