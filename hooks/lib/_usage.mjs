// The user's Claude usage, from the copy of the /api/oauth/usage response that
// Claude Code caches in ~/.claude.json (`cachedUsageUtilization`). Claude Code
// writes it whenever it fetches usage and treats it as stale after an hour;
// dotclaude uses the same limit. No token is read and nothing is fetched.
// Also the main conversation's context size, from the end of its transcript.

import fs from "node:fs";
import path from "node:path";
import {
  AUTO_COMPACT_TOKENS,
  COMPACTIONS_BEFORE_HANDOFF,
  CONTEXT_NOTE_TOKENS,
  k,
} from "./_budget.mjs";
import { stateDir } from "./_core.mjs";
import { compactionCount, nodeIo } from "./_io-node.mjs";
import { readConfig } from "./_plans.mjs";
import { tail } from "./_transcript.mjs";
import { mainContextFromText } from "./_transcript-parse.mjs";

const MAX_AGE_MS = 60 * 60 * 1000;

/**
 * { session, weekly, fable } as percentages, { sessionResetsAt,
 * weeklyResetsAt } as epoch ms (each null when absent), and fetchedAtMs, or
 * null when there is no fresh copy.
 */
export async function readUsage(io, now = Date.now()) {
  const cached = (await readConfig(io))?.cachedUsageUtilization;
  const at = Number(cached?.fetchedAtMs);
  if (!Number.isFinite(at) || now - at < 0 || now - at > MAX_AGE_MS)
    return null;
  const u = cached.utilization ?? {};
  const pct = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const time = (v) => {
    const ms = Date.parse(v ?? "");
    return Number.isFinite(ms) ? ms : null;
  };
  const out = {
    session: pct(u.five_hour?.utilization),
    weekly: pct(u.seven_day?.utilization),
    fable: null,
    sessionResetsAt: time(u.five_hour?.resets_at),
    weeklyResetsAt: time(u.seven_day?.resets_at),
    fetchedAtMs: at,
  };
  for (const limit of Array.isArray(u.limits) ? u.limits : []) {
    if (limit?.kind === "session") {
      out.session = pct(limit.percent);
      out.sessionResetsAt = time(limit.resets_at) ?? out.sessionResetsAt;
    } else if (limit?.kind === "weekly_all") {
      out.weekly = pct(limit.percent);
      out.weeklyResetsAt = time(limit.resets_at) ?? out.weeklyResetsAt;
    } else if (
      limit?.kind === "weekly_scoped" &&
      /fable/i.test(limit?.scope?.model?.display_name ?? "")
    )
      out.fable = pct(limit.percent);
  }
  return out.session === null && out.weekly === null ? null : out;
}

/**
 * The main conversation's context in tokens: the input of its last response,
 * or the size after a later compaction. Null when the last 1 MB of the
 * transcript has neither.
 */
export function mainContextTokens(transcriptPath) {
  const text = transcriptPath ? tail(transcriptPath, 1_000_000) : null;
  return text ? mainContextFromText(text) : null;
}

/**
 * Compactions recorded in a transcript, or 0 when it cannot be read. The
 * reader and its cache are `compactionCount` in `_io-node.mjs`.
 */
export function compactions(transcriptPath) {
  return compactionCount(transcriptPath) ?? 0;
}

/**
 * The `<context_use>` note when the main context is at CONTEXT_NOTE_TOKENS or
 * more after COMPACTIONS_BEFORE_HANDOFF compactions, else null. Before that,
 * automatic compaction runs. With `once`, the note comes only the first time
 * after the context was last under the bound, so a long run of tool calls
 * gets it once. Without `once`, a later note in the same crossing gives only
 * the size and refers to the first one, so Claude does not write the handoff
 * again for each prompt.
 * Each note marks the session, so a note after a prompt also counts.
 */
export function contextNote(data, once = false) {
  const used = mainContextTokens(data.transcript_path);
  if (used === null) return null;
  const safe = String(data.session_id || "unknown").replace(
    /[^A-Za-z0-9_-]/g,
    "_",
  );
  const file = path.join(stateDir(nodeIo()), `${safe}.context-note`);
  if (used < CONTEXT_NOTE_TOKENS) {
    fs.rmSync(file, { force: true });
    return null;
  }
  const told = fs.existsSync(file);
  if (once && told) return null;
  const count = compactions(data.transcript_path);
  if (count < COMPACTIONS_BEFORE_HANDOFF) return null;
  if (told)
    return `<context_use source="dotclaude">The main context is ${k(used)} tokens after ${count} compactions. An earlier note in this context asked for a handoff note. If you did not write it, write it now. If you wrote it, update it only when a decision or the state changed, or when this request cannot finish before Claude Code compacts at about ${k(AUTO_COMPACT_TOKENS)} tokens. Continue the work, and at the next natural stop ask the user to run \`/clear\`.</context_use>`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "");
  return `<context_use source="dotclaude">The main context is ${k(used)} tokens after ${count} compactions. Each compaction summarizes the previous summary again, so the earliest facts degrade. Claude Code compacts again at about ${k(AUTO_COMPACT_TOKENS)} tokens, and a step can take longer than that. Thus write a handoff note now with the \`handoff\` skill, before you finish the current step. If you wrote one after the last compaction, update it only when the state changed. This note does not stop the work. After the handoff, continue the current step and the user's requests, and add each new request to the handoff note. At the next natural stop, ask the user to run \`/clear\`.</context_use>`;
}
