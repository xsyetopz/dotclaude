#!/usr/bin/env bun
// PreCompact hook: save the user's recent prompts before compaction so the
// SessionStart(compact) hook can restore them verbatim.

import { option, run } from "../lib/_common.mjs";
import { load, save } from "../lib/_ledger.mjs";
import { recentPrompts } from "../lib/_transcript.mjs";

run((data) => {
  if (!option("compact_carryover") || !data.transcript_path) return;
  const prompts = recentPrompts(data.transcript_path);
  if (!prompts.length) return;
  const state = load(data.session_id, null);
  state.prompts = prompts;
  save(data.session_id, null, state);
});
