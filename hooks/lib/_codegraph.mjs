// The CodeGraph augment: a search for one symbol name gets the callers and callees of that symbol from the CodeGraph index, added to the search result.
// Claude does not have to choose the tool, because the graph comes with the search that it already ran.
// The design follows the GitNexus hooks (`docs/dossier/usage.md`).
// The code is our own.

import { CODEGRAPH_NEIGHBOURS, CODEGRAPH_NOTE_MAX_CHARS } from "./_budget.mjs";

const IDENTIFIER = /^[A-Za-z_$][\w$]{2,}$/;

// The flags of `rg` and `grep` whose next word is a value, not the pattern.
const VALUE_FLAGS = new Set([
  "-f",
  "-m",
  "-A",
  "-B",
  "-C",
  "-g",
  "-t",
  "-T",
  "--glob",
  "--type",
  "--type-not",
  "--include",
  "--exclude",
  "--max-count",
  "--context",
]);

/** A pattern without its quotes and word anchors, if it is one name. */
function symbolOf(pattern) {
  const clean = String(pattern ?? "")
    .replace(/^(['"])(.*)\1$/, "$2")
    .replace(/^\\b|\\b$|^\\<|\\>$/g, "")
    .replace(/^\^|\$$/g, "");
  return IDENTIFIER.test(clean) ? clean : undefined;
}

/** The pattern of the first `rg` or `grep` in a command, or undefined. */
function bashPattern(command) {
  const words = String(command).match(/'[^']*'|"[^"]*"|[^\s|;&()]+|[|;&()]/g);
  const start = words?.findIndex((w) => /^(rg|grep|egrep)$/.test(w)) ?? -1;
  if (start < 0) return undefined;
  for (let i = start + 1; i < words.length; i++) {
    const w = words[i];
    if (/^[|;&()]$/.test(w)) return undefined;
    if (w === "-e" || w === "--regexp") return words[i + 1];
    if (VALUE_FLAGS.has(w)) i++;
    else if (!w.startsWith("-")) return w;
  }
  return undefined;
}

/**
 * The symbol name that a `Grep` or Bash `rg`/`grep` call searches for,
 * or undefined when the search is a regex, a phrase, or no search.
 */
export function searchSymbol(e) {
  if (e.tool === "Grep") return symbolOf(e.pattern);
  if (e.tool === "Bash") return symbolOf(bashPattern(e.command ?? ""));
  return undefined;
}

/** The commands to run for `symbol`, in the order of `graphNote`. */
export const graphCommands = (symbol) => [
  ["codegraph", "callers", symbol, "-j", "-l", String(CODEGRAPH_NEIGHBOURS)],
  ["codegraph", "callees", symbol, "-j", "-l", String(CODEGRAPH_NEIGHBOURS)],
];
export const STATUS_COMMAND = ["codegraph", "status", "--json"];
export const SYNC_COMMAND = ["codegraph", "sync"];

/** Parsed JSON, or undefined. "Not found" output from CodeGraph is text. */
function json(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const list = (nodes) =>
  (Array.isArray(nodes) ? nodes : [])
    .filter((n) => n?.name && n.kind !== "file" && n.kind !== "import")
    .map((n) => `${n.name} (${n.filePath}:${n.startLine})`)
    .join(", ");

/**
 * The note for the search result, from the `callers -j` and `callees -j` output,
 * or undefined when the index has no edge for the symbol.
 */
export function graphNote(symbol, callersText, calleesText) {
  const callers = list(json(callersText)?.callers);
  const callees = list(json(calleesText)?.callees);
  if (!callers && !callees) return undefined;
  const text = [
    `The CodeGraph index gives these call paths of \`${symbol}\`. Use them to choose which code to read next.`,
    callers && `Called by: ${callers}`,
    callees && `Calls: ${callees}`,
    "CodeGraph can link a call to a different function with the same name, such as a local helper. Before you rely on a link, read the call in the source.",
    `For the source with call paths, run \`codegraph explore "${symbol}"\`.`,
  ]
    .filter(Boolean)
    .join("\n");
  return text.length > CODEGRAPH_NOTE_MAX_CHARS
    ? `${text.slice(0, CODEGRAPH_NOTE_MAX_CHARS)}…`
    : text;
}

/**
 * The state of the index from `codegraph status --json`: `none` when the project has no index, `stale` with a note, or `ok`.
 * `pending` is true when `codegraph sync` can make a stale index current.
 */
export function indexState(statusText) {
  const s = json(statusText);
  if (!s?.initialized) return { state: "none" };
  const p = s.pendingChanges ?? {};
  const pending = (p.added ?? 0) + (p.modified ?? 0) + (p.removed ?? 0);
  if (!pending && !s.index?.reindexRecommended) return { state: "ok" };
  const why = pending
    ? `${pending} changed file(s) that it does not include`
    : "a format from an earlier CodeGraph version";
  return {
    state: "stale",
    pending: pending > 0,
    note: `The CodeGraph index of this project has ${why}, so its call paths can be out of date. Run \`codegraph sync\` to update the index before you rely on them.`,
  };
}
