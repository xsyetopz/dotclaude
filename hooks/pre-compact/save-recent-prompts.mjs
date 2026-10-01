#!/usr/bin/env bun
// PreCompact hook: save the user's recent prompts before compaction so the
// SessionStart(compact) hook can restore them verbatim. It also forgets the
// full reads, because the summary drops their content. A subagent keeps no
// prompts, because only the main conversation restores them.

import { option, run } from "../lib/_common.mjs";
import { load, save } from "../lib/_ledger.mjs";
import { isSubagent, recentPrompts } from "../lib/_transcript.mjs";

run((data) => {
  const sub = isSubagent(data);
  // With no `agent_id`, the subagent's ledger is unknown. Leave all state.
  if (sub && !data.agent_id) return;
  const state = load(data.session_id, data.agent_id ?? null);
  const hadReads = Boolean(state.reads);
  delete state.reads;
  const prompts =
    !sub && option("context_compact_carryover") && data.transcript_path
      ? recentPrompts(data.transcript_path)
      : [];
  if (prompts.length) state.prompts = prompts;
  if (prompts.length || hadReads)
    save(data.session_id, data.agent_id ?? null, state);
});
