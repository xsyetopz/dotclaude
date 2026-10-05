// The CodeGraph augment: a search for one symbol name gets the callers and callees of that symbol from the CodeGraph index, added to the search result.
// Claude does not have to choose the tool, because the graph comes with the search that it already ran.
// The design follows the GitNexus hooks (`wiki/Usage-Evidence.md`).
// The code is our own.

import {
  CODEGRAPH_NEIGHBOURS,
  CODEGRAPH_NOTE_MAX_CHARS,
  CODEGRAPH_QUERY_LIMIT,
} from "../budget.mjs";
import { clause } from "../terms.mjs";

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
  switch (e.tool) {
    case "Grep":
      return symbolOf(e.pattern);
    case "Bash":
      return symbolOf(bashPattern(e.command ?? ""));
    default:
      return undefined;
  }
}

// The node kinds that have call edges. A search for another name, such as a
// constant or a word in a comment, gets no note.
const DEFINITION_KINDS = new Set([
  "function",
  "method",
  "class",
  "struct",
  "interface",
  "trait",
  "protocol",
  "component",
]);

/** The command that finds the index nodes for `symbol`. */
export const queryCommand = (symbol) => [
  "codegraph",
  "query",
  symbol,
  "-j",
  "-l",
  String(CODEGRAPH_QUERY_LIMIT),
];

/**
 * The node from `query -j` output whose name is `symbol` and that can have
 * call edges, or undefined. `callers` and `callees` fall back to a text
 * search for a name that is not a symbol, so the hook asks for them only
 * after this check.
 */
export function definitionOf(queryText, symbol) {
  const results = json(queryText);
  if (!Array.isArray(results)) return undefined;
  return results
    .map((r) => r?.node)
    .find((n) => n?.name === symbol && DEFINITION_KINDS.has(n.kind));
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

const place = (n) => `${n.name} (${n.filePath}:${n.startLine})`;

const list = (nodes) =>
  (Array.isArray(nodes) ? nodes : [])
    .filter((n) => n?.name && n.kind !== "file" && n.kind !== "import")
    .map(place)
    .join(", ");

/**
 * The note for the search result, from the definition node of the symbol and
 * the `callers -j` and `callees -j` output, or undefined when the index has
 * no edge for the symbol.
 */
export function graphNote(definition, callersText, calleesText) {
  const callers = list(json(callersText)?.callers);
  const callees = list(json(calleesText)?.callees);
  if (!callers && !callees) return undefined;
  const symbol = definition.name;
  const text = [
    `The CodeGraph index gives these call paths of the ${definition.kind} ${place(definition)}. Use them to choose which code to read next.`,
    callers && `Called by: ${callers}`,
    callees && `Calls: ${callees}`,
    "CodeGraph can link a call to a different function with the same name, such as a local helper. Before you rely on a link, read the call in the source.",
    `For the source with call paths, run \`codegraph explore "${symbol}"\`.`,
  ]
    .filter(Boolean)
    .join("\n");
  return clause(
    "codegraph",
    text.length > CODEGRAPH_NOTE_MAX_CHARS
      ? `${text.slice(0, CODEGRAPH_NOTE_MAX_CHARS)}…`
      : text,
  );
}

export const INDEX_COMMAND = ["codegraph", "index", "-q"];

/**
 * The state of the index from `codegraph status --json`: `none` when the project has no index, `stale` with a note, or `ok`.
 * `reindex` is true when the index has a format from an earlier CodeGraph version, and `codegraph index` builds it again.
 * Otherwise `pending` is true when `codegraph sync` can make a stale index current.
 * `codegraph sync` does not clear `reindexRecommended`, so that note names `codegraph index`.
 */
export function indexState(statusText) {
  const s = json(statusText);
  if (!s?.initialized) return { state: "none" };
  const p = s.pendingChanges ?? {};
  const pending = (p.added ?? 0) + (p.modified ?? 0) + (p.removed ?? 0);
  const reindex = Boolean(s.index?.reindexRecommended);
  if (!pending && !reindex) return { state: "ok" };
  const note = reindex
    ? "The CodeGraph index of this project has a format from an earlier CodeGraph version, so its call paths can be incomplete. Tell the user that `codegraph index` builds the index again."
    : `The CodeGraph index of this project has ${pending} changed file(s) that it does not include, so its call paths can be out of date. Run \`codegraph sync\` to update the index before you rely on them.`;
  return { state: "stale", reindex, pending: !reindex && pending > 0, note };
}

/**
 * The session start note for a git repository at `root` without a CodeGraph index.
 * The Bash guard asks the user before `codegraph init`, so Claude can run it.
 */
export const initNote = (root) =>
  clause(
    "codegraph-index",
    `<codegraph_index>
The project at \`${root}\` has no CodeGraph index, so code searches get no call paths.
Before the first code search or code read of this session, run \`codegraph init -y\` in \`${root}\`.
The Bash guard asks the user for approval, because the command writes a \`.codegraph/\` folder in the project.
If the user does not approve, do not run the command again in this session.
</codegraph_index>`,
  );
