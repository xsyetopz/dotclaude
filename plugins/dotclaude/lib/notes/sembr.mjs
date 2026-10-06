// Semantic line breaks from sembr (https://github.com/admk/sembr).
// sembr keeps the line breaks that it gets, so each prose block goes to it
// as one line. A result that changes more than whitespace is not used,
// because sembr can split a Markdown link or a code span.

import {
  LINE_BREAK_NOTE_MAX_BLOCKS,
  SEMBR_MAX_TOKENS,
  SEMBR_MIN_TOKENS,
} from "../budget.mjs";
import { clause } from "../terms.mjs";

export const SEMBR_COMMAND = [
  "sembr",
  "--file-type",
  "markdown",
  "-c",
  `optimize.preferred_min_tokens_per_line=${SEMBR_MIN_TOKENS}`,
  "-c",
  `optimize.preferred_max_tokens_per_line=${SEMBR_MAX_TOKENS}`,
];

const MARKDOWN_FILE = /\.(md|mdx|markdown|txt)$/i;
const SLASH_FILE =
  /\.([cm]?[jt]sx?|c|h|cc|cpp|hpp|cs|go|rs|java|kt|kts|swift|scala|dart|zig|php|proto)$/i;
const HASH_FILE =
  /(\.(py|sh|bash|zsh|fish|rb|pl|r|ya?ml|toml|nix|ps1|tf)|(^|\/)(Makefile|Dockerfile|[Jj]ustfile))$/;

/** The kind of prose in `file`: `markdown`, `slash` or `hash` comments, or undefined. */
export function proseKind(file) {
  if (MARKDOWN_FILE.test(file)) return "markdown";
  if (SLASH_FILE.test(file)) return "slash";
  if (HASH_FILE.test(file)) return "hash";
  return undefined;
}

const COMMENT = {
  slash: /^(\s*(?:\/\/[/!]?|\*(?!\/)))( ?)(.*)$/,
  hash: /^(\s*#+)( ?)(.*)$/,
};
const LIST = /^(([-*+]|\d+[.)])\s+)(.*)$/;
// Tool directives, tags, and a shebang are not prose.
const NOT_PROSE =
  /^(@|!|-\*-|eslint|biome-ignore|prettier-ignore|istanbul|c8 |noqa|pylint|fmt:|go:|nolint|type:)/;
// A lowercase `key:` line is front matter, also in an edit with no `---`.
const MARKDOWN_SKIP =
  /^\s*(#|\||<|>|\[[^\]]+\]:|[a-z][\w-]*:(\s|$)|(-{3,}|\*{3,}|_{3,}|={3,})\s*$)/;
const FENCE = /^\s*(```|~~~)/;
const TRAILER = /^([A-Z][a-z]*(-[A-Za-z]+)+|Fixes|Closes|Refs|Resolves): \S/;
const spaces = (s) => " ".repeat(s.length);

/** One Markdown line as `{ prefix, rest, body, start }`, or null. */
function markdownLine(line, state, open) {
  if (FENCE.test(line)) {
    state.fence = !state.fence;
    return null;
  }
  if (state.fence || !line.trim() || MARKDOWN_SKIP.test(line)) return null;
  const indent = /^\s*/.exec(line)[0];
  const item = LIST.exec(line.slice(indent.length));
  if (item)
    return {
      prefix: indent + item[1],
      rest: indent + spaces(item[1]),
      body: item[3],
      start: true,
    };
  if (indent.length >= 4 && !open) return null;
  return { prefix: indent, rest: indent, body: line.trim() };
}

/** One comment line as `{ prefix, rest, body, start, key }`, or null. */
function commentLine(line, kind, state, open) {
  if (kind === "slash") {
    if (/\/\*/.test(line) && !/\*\//.test(line)) state.block = true;
    if (/\*\//.test(line)) {
      state.block = false;
      return null;
    }
  }
  const m = COMMENT[kind].exec(line);
  if (!m || (m[1].trim() === "*" && !state.block)) return null;
  const [, mark, gap, body] = m;
  const key = mark + gap;
  if (!body.trim() || NOT_PROSE.test(body)) return null;
  if (/^\s/.test(body))
    return open?.list && open.key === key
      ? { prefix: key, rest: key, body: body.trim(), key }
      : null;
  const item = LIST.exec(body);
  if (item)
    return {
      prefix: key + item[1],
      rest: key + spaces(item[1]),
      body: item[3],
      start: true,
      list: true,
      key,
    };
  return { prefix: key, rest: key, body, key };
}

/**
 * The prose blocks of `text`, each as `{ from, to, prefix, rest, bodies }`.
 * `kind` is `markdown`, `slash`, `hash`, or `commit`. A commit message is
 * Markdown without its subject line and its trailers.
 */
export function proseBlocks(text, kind) {
  const blocks = [];
  const state = {};
  let open = null;
  text.split("\n").forEach((line, i) => {
    let p;
    // Front matter starts at the first line and ends at the next `---`.
    if (kind === "markdown" && (i === 0 || state.front) && line === "---")
      state.front = !state.front;
    else if (state.front) p = null;
    else if (kind === "commit")
      p =
        i === 0 || TRAILER.test(line) ? null : markdownLine(line, state, open);
    else if (kind === "markdown") p = markdownLine(line, state, open);
    else p = commentLine(line, kind, state, open);
    if (!p) open = null;
    else if (p.start || !open || p.key !== open.key) {
      open = { from: i, to: i, ...p, bodies: [p.body] };
      blocks.push(open);
    } else {
      open.to = i;
      open.bodies.push(p.body);
    }
  });
  return blocks;
}

const norm = (s) => s.replace(/\s+/g, " ").trim();
const INLINE_SENTENCE_END = /(?<=[.!?]["')`\]]*) (?=[A-Z])/;

/**
 * The sembr lines of each block, or null for a block whose result changed
 * more than whitespace. Null for all when sembr is missing or fails.
 * `run(argv, stdin)` runs a command.
 */
export async function sembrLines(run, blocks) {
  if (!blocks.length) return [];
  const input = blocks.map((b) => norm(b.bodies.join(" ")));
  let out;
  try {
    const r = await run(SEMBR_COMMAND, input.join("\n\n"));
    if (r.exitCode !== 0) return null;
    out = r.stdout.trim().split(/\n[ \t]*\n/);
  } catch {
    return null;
  }
  if (out.length !== input.length) return null;
  return out.map((o, i) => {
    // sembr can keep two sentences on one line.
    const lines = o
      .split("\n")
      .flatMap((l) => norm(l).split(INLINE_SENTENCE_END))
      .filter(Boolean);
    return lines.join(" ") === input[i] ? lines : null;
  });
}

/** The offsets of the line ends in the joined text, without the last line. */
function breaks(lines) {
  const out = new Set();
  let at = 0;
  for (const line of lines.slice(0, -1)) {
    at += norm(line).length + 1;
    out.add(at);
  }
  return out;
}

const OPENERS = new Set(
  "and but or nor so yet because although though while whereas if unless until when where which who whose that then since after before as once than".split(
    " ",
  ),
);
const SENTENCE_END = /[.!?]["')`\]]*$/;

/**
 * True when `lines` break at a column: a break that sembr does not give and
 * that is not at a clause, or a sentence end that sembr breaks inside a line.
 */
export function misbroken(lines, fixed) {
  const joined = norm(lines.join(" "));
  const have = breaks(lines);
  const want = breaks(fixed);
  for (const at of have) {
    if (want.has(at)) continue;
    const before = joined.slice(0, at - 1);
    const next = joined.slice(at).split(" ")[0].toLowerCase();
    if (
      !/[,;:]$/.test(before) &&
      !SENTENCE_END.test(before) &&
      !OPENERS.has(next)
    )
      return true;
  }
  for (const at of want)
    if (!have.has(at) && SENTENCE_END.test(joined.slice(0, at - 1)))
      return true;
  return false;
}

/** The lines of `block` with the sembr lines in place of its text. */
const rewrapped = (block, lines) =>
  lines.map((l, i) => (i ? block.rest : block.prefix) + l);

/**
 * The blocks of `text` that break at a column, each with its fixed lines.
 * Null when sembr is missing or fails.
 */
export async function lineBreakFixes(run, text, kind) {
  const blocks = proseBlocks(text, kind);
  const fixed = await sembrLines(run, blocks);
  if (!fixed) return null;
  return blocks
    .map((block, i) => ({ block, lines: fixed[i] }))
    .filter(({ block, lines }) => lines && misbroken(block.bodies, lines))
    .map(({ block, lines }) => ({ ...block, fixed: rewrapped(block, lines) }));
}

/** `text` with each block that breaks at a column rewrapped by sembr. */
export async function rewrapText(run, text, kind) {
  const fixes = await lineBreakFixes(run, text, kind);
  if (!fixes?.length) return text;
  const lines = text.split("\n");
  for (const fix of [...fixes].reverse())
    lines.splice(fix.from, fix.to - fix.from + 1, ...fix.fixed);
  return lines.join("\n");
}

/**
 * The message spans of a `git commit` or `gh pr` command: heredoc bodies,
 * and `-m` or `--body` values in quotes without expansions. Each span is
 * `{ start, end, kind }`, and only the first span of a commit has a subject.
 */
export function messageSpans(command, commit) {
  const spans = [];
  const heredoc = /<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n/g;
  for (const m of command.matchAll(heredoc)) {
    const start = m.index + m[0].length;
    const end = new RegExp(`^[\\t ]*${m[2]}[\\t ]*$`, "m").exec(
      command.slice(start),
    );
    if (end) spans.push({ start, end: start + Math.max(end.index - 1, 0) });
  }
  const quoted =
    /(?:^|\s)(?:-m|--message|-b|--body)(?:\s+|=)(?:"([^"\\$`]*)"|'([^']*)')/g;
  for (const m of command.matchAll(quoted)) {
    const value = m[1] ?? m[2];
    const start = m.index + m[0].length - value.length - 1;
    spans.push({ start, end: start + value.length });
  }
  spans.sort((a, b) => a.start - b.start);
  // A quoted flag in a heredoc body is text of that body.
  return spans
    .filter((s, i) => !spans.slice(0, i).some((p) => s.start < p.end))
    .map((s, i) => ({
      ...s,
      kind: commit && i === 0 ? "commit" : "markdown",
    }));
}

/** `command` with semantic line breaks in its messages. */
export async function rewrapCommand(run, command, commit) {
  let out = command;
  for (const span of messageSpans(command, commit).reverse()) {
    const text = out.slice(span.start, span.end);
    const next = await rewrapText(run, text, span.kind);
    out = out.slice(0, span.start) + next + out.slice(span.end);
  }
  return out;
}

export const GH_MESSAGE =
  /(^|[\s;&|(])gh\s+(pr|issue)\s+(create|edit|comment)\b/;

export const COMMAND_NOTE = clause(
  "line-breaks",
  "<line_breaks>\nThe hook changed the line breaks of the message in this command to semantic line breaks with `sembr`.\nWrite semantic line breaks in the next commit, pull request, or issue message, so that the hook does not change it.\n</line_breaks>",
);

/** The note that gives the fixed lines of each block in `name`. */
export function lineBreakNote(name, fixes) {
  const shown = fixes.slice(0, LINE_BREAK_NOTE_MAX_BLOCKS);
  const more =
    fixes.length > shown.length
      ? `\n${fixes.length - shown.length} more blocks have the same problem.\nChange them in the same way.`
      : "";
  const blocks = shown
    .map((f) => `<fixed_text>\n${f.fixed.join("\n")}\n</fixed_text>`)
    .join("\n");
  return clause(
    "line-breaks",
    `<line_breaks>\nThe edit of \`${name}\` has prose that breaks lines at a column.\nA semantic line break starts each sentence on a new line.\nIt breaks a long sentence only between clauses.\nThen editors can wrap the text, and diffs stay small.\n\`sembr\` gives the text below.\nUse \`Edit\` to change each block to this text, unless the project wraps prose at a column.\n${blocks}${more}\n</line_breaks>`,
  );
}
