// Pure parsers over the text of a session transcript (JSONL). This file
// imports nothing, so the facts of `io.session` and the sync readers of
// `_transcript.mjs`, `_usage.mjs`, and `_nested-instructions.mjs` share one
// copy of each parser. The transcript layout is not a documented contract,
// so each parser is best-effort: it skips a line that it does not know.

/** The longest last prompt that `io.session.lastPrompt()` gives. */
export const LAST_PROMPT_CHARS = 4000;

/**
 * The entry of one transcript line, or null when the line is not a JSON
 * object. A tail read cuts the first line, and a line can be `null` or a
 * number.
 */
function entryOf(line) {
  try {
    const entry = JSON.parse(line);
    return entry !== null && typeof entry === "object" ? entry : null;
  } catch {
    return null;
  }
}

function isHuman(entry) {
  const kind = entry.origin?.kind;
  return kind === undefined ? !entry.isMeta : kind === "human";
}

function promptOf(entry) {
  if (
    entry.type === "user" &&
    typeof entry.message?.content === "string" &&
    !entry.isMeta &&
    // Claude Code stores the compaction summary as a user entry.
    !entry.isCompactSummary &&
    !entry.isSidechain &&
    isHuman(entry)
  ) {
    return entry.message.content;
  }
  const att = entry.type === "attachment" ? entry.attachment : null;
  if (
    att?.type === "queued_command" &&
    typeof att.prompt === "string" &&
    (att.humanTurn || att.origin?.kind === "human")
  ) {
    return att.prompt;
  }
  return undefined;
}

/**
 * The last `limit` prompts that the user typed, oldest first, each cut at
 * `maxChars`.
 */
export function promptsFromText(text, limit = 5, maxChars = 600) {
  // Scan from the end and stop at `limit` prompts: parsing every line of an
  // 8 MB tail costs about 20 ms. With a `limit` that is not a positive
  // integer, the scan reads all lines, and `slice` gives the old result.
  const prompts = [];
  const lines = text.split("\n");
  for (
    let i = lines.length - 1;
    i >= 0 && !(limit > 0 && prompts.length === limit);
    i -= 1
  ) {
    const line = lines[i];
    if (!line.trim()) continue;
    const entry = entryOf(line);
    if (!entry) continue;
    const prompt = promptOf(entry)?.trim();
    if (!prompt || prompt.startsWith("<") || prompt.startsWith("Caveat:"))
      continue;
    prompts.push(
      prompt.length > maxChars ? `${prompt.slice(0, maxChars)} [...]` : prompt,
    );
  }
  return prompts.reverse().slice(-limit);
}

/**
 * A subagent's transcript: Claude Code keeps it in
 * `<session>/subagents/agent-<id>.jsonl` next to the session's transcript.
 * `path` is a path module, `node:path` or one from `pathFor`.
 */
export function subagentTranscriptIn(path, transcriptPath, sessionId, agentId) {
  const id = String(agentId).replace(/^agent-/, "");
  return path.join(
    path.dirname(transcriptPath),
    String(sessionId),
    "subagents",
    `agent-${id}.jsonl`,
  );
}

/**
 * API calls in a subagent transcript since its latest prompt, resume message,
 * or background-task wake-up. Claude Code starts the `maxTurns` count again at
 * each of those, so earlier calls do not count.
 */
export function turnsFromText(text) {
  const lines = text.split("\n");
  const ids = new Set();
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) continue;
    const entry = entryOf(line);
    if (!entry) continue;
    if (entry.type === "assistant" && entry.message?.id)
      ids.add(entry.message.id);
    if (entry.type === "user") {
      const content = entry.message?.content;
      const toolResult =
        Array.isArray(content) &&
        content.some((b) => b?.type === "tool_result");
      // Wake-ups and SendMessage resumes are meta entries with an origin;
      // meta reminders without one do not restart the count.
      const kind = entry.origin?.kind;
      const restart =
        !entry.isMeta || kind === "task-notification" || kind === "coordinator";
      if (!toolResult && restart) break;
    }
  }
  return ids.size;
}

const tokensOf = (u) =>
  (u.input_tokens ?? 0) +
  (u.cache_read_input_tokens ?? 0) +
  (u.cache_creation_input_tokens ?? 0);

/**
 * Context tokens of the first and latest API calls in a subagent transcript
 * (input plus cache reads and writes), or null without a readable call.
 */
export function contextFromText(text) {
  let first = null;
  let last = null;
  for (const line of text.split("\n")) {
    if (!line.includes('"usage"')) continue;
    const entry = entryOf(line);
    if (!entry) continue;
    const u = entry.type === "assistant" ? entry.message?.usage : null;
    if (!u) continue;
    last = tokensOf(u);
    first ??= last;
  }
  return last === null ? null : { first, last };
}

/**
 * The main conversation's context in tokens: the input of its last response,
 * or the size after a later compaction. Null when the text has neither.
 */
export function mainContextFromText(text) {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.includes('"usage"') && !line.includes('"compact_boundary"'))
      continue;
    const entry = entryOf(line);
    if (!entry) continue;
    if (entry.isSidechain) continue;
    if (entry.type === "system" && entry.subtype === "compact_boundary") {
      const after = Number(entry.compactMetadata?.postTokens);
      return Number.isFinite(after) ? after : null;
    }
    const u = entry.type === "assistant" ? entry.message?.usage : null;
    if (u) return tokensOf(u);
  }
  return null;
}

/** Paths that the transcript shows Claude Code loaded as nested memory. */
export function nestedFromText(text) {
  const loaded = new Set();
  for (const line of text.split("\n")) {
    if (!line.includes('"nested_memory"')) continue;
    const att = entryOf(line)?.attachment;
    if (att?.type === "nested_memory" && att.path) loaded.add(att.path);
  }
  return loaded;
}

/**
 * Compactions recorded in the text. A quote inside a message is escaped in
 * JSON, so the marker finds only a real `compact_boundary` entry.
 */
export function compactionsFromText(text) {
  let count = 0;
  for (const line of text.split("\n")) {
    if (!line.includes('"subtype":"compact_boundary"')) continue;
    const entry = entryOf(line);
    if (entry?.type === "system" && entry.subtype === "compact_boundary")
      count += 1;
  }
  return count;
}

/**
 * True when a task notification in the main transcript shows that agent `id`
 * stopped at its turn limit.
 */
export function stoppedAtLimitInText(text, id) {
  const tag = `<task-id>${id}</task-id>`;
  let at = text.indexOf(tag);
  while (at !== -1) {
    const end = text.indexOf("</task-notification>", at);
    const note = text.slice(at, end === -1 ? at + 4000 : end);
    if (/stopped at its \d+-turn limit/.test(note)) return true;
    at = text.indexOf(tag, at + tag.length);
  }
  return false;
}
