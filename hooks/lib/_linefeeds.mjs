// Line-break checks for the text that an edit writes. The convention is
// semantic line breaks: each sentence starts on a new line, and a long
// sentence breaks only between clauses, never at a column.
// `semlf` (https://pypi.org/project/semlf/) does the full check when it is on
// PATH. The built-in check finds two defects of a column wrap: a word split
// over two comment lines, and a prose line that stops inside a clause.
// `semlf` 1.0.1 does not find a split word, so that check always runs.

/** Path parts that `semlf` skips too: generated, vendored, and test data. */
const SKIP = /(^|\/)(tmp|vendor|node_modules|dist|build|testdata|fixtures)\//;
const MARKDOWN = /\.(md|mdx|markdown)$/i;
const HASH =
  /(\.(py|sh|bash|zsh|fish|rb|pl|r|ya?ml|toml|ps1|nix)|(^|\/)(Makefile|Dockerfile|justfile|Justfile))$/;
/** A raw line shorter than this is not a column wrap. */
const WRAP_MIN = 60;
/** A finding list longer than this is cut, to keep the note short. */
const MAX_FINDINGS = 5;
/** Words that can start a clause, so a break before them is semantic. */
const OPENERS = new Set(
  "and but or nor so yet because although though while whereas if unless until when whenever where wherever which who whom whose that then since after before as once than".split(
    " ",
  ),
);
const BLOCK_START = /^\s*([-*+]\s|\d+[.)]\s|#|\||```|~~~|<|>|\[[^\]]+\]:)/;

/**
 * The report of `semlf --hook claude` for one PostToolUse input, or null when
 * `semlf` is missing or fails. An empty string means no findings.
 */
export async function semlfReport(io, data) {
  let result;
  try {
    result = await io.run(["semlf", "--hook", "claude"], {
      cwd: io.cwd || io.tmp,
      stdin: JSON.stringify(data),
      timeoutMs: 8000,
    });
  } catch {
    return null;
  }
  // Exit 2 is a blocking finding on stderr. Exit 0 gives advice as hook JSON
  // on stdout, or nothing.
  if (result.exitCode === 2) return result.stderr.trim();
  if (result.exitCode !== 0) return null;
  if (!result.stdout.trim()) return "";
  try {
    const text = JSON.parse(result.stdout)?.hookSpecificOutput
      ?.additionalContext;
    return typeof text === "string" ? text.trim() : "";
  } catch {
    return "";
  }
}

/** True when the line-break check skips the file at `file`. */
export function skipped(file, tmp) {
  const slashed = file.replaceAll("\\", "/");
  if (tmp && slashed.startsWith(`${tmp.replaceAll("\\", "/")}/`)) return true;
  return SKIP.test(slashed);
}

/** The texts that an edit tool writes, from its input. */
export function writtenTexts(input = {}) {
  const texts = [input.content, input.new_string, input.new_source];
  if (Array.isArray(input.edits))
    for (const edit of input.edits) texts.push(edit?.new_string);
  return texts.filter((text) => typeof text === "string" && text);
}

/**
 * The prose lines of `text` as `{ raw, body, family }`, in order. `body` is
 * the text after a comment marker or a list marker. A line that is not prose
 * gets `body: null`. Markdown gives all lines outside code. Other files give
 * only their comment lines, with `family` set to the comment marker.
 */
function proseLines(text, markdown, hash) {
  const out = [];
  let fence = false;
  let front = markdown && text.startsWith("---\n");
  for (const [i, raw] of text.split("\n").entries()) {
    if (markdown) {
      if (front) {
        if (i > 0 && raw === "---") front = false;
        out.push({ raw, body: null });
        continue;
      }
      if (/^\s*(```|~~~)/.test(raw)) fence = !fence;
      const block = fence || /^\s*(```|~~~|#|\||<|\[[^\]]+\]:)/.test(raw);
      const body = raw.replace(/^\s*([-*+]\s+|\d+[.)]\s+)?/, "");
      out.push({
        raw,
        body: block || !body.trim() ? null : body,
        family: "md",
      });
      continue;
    }
    const m = hash
      ? /^\s*(#+)(?!!)(.*)$/.exec(raw)
      : /^\s*(\/\*\*?|\*(?!\/)|\/\/+)(.*)$/.exec(raw);
    if (!m) {
      out.push({ raw, body: null });
      continue;
    }
    const family = m[1].startsWith("/*") ? "*" : m[1];
    out.push({ raw, body: m[2], family });
  }
  return out;
}

/** The last word of a line and the first word of the next, for a quote. */
const quote = (a, b) =>
  `\`${a.trim().split(/\s+/).at(-1)}\` | \`${b.trim().split(/\s+/)[0]}\``;

/**
 * The line-break defects in `text`, a text that an edit wrote to `file`, as
 * `{ kind, quote }`. `kind` is `split` for a word split over two comment
 * lines, and `wrap` for a prose line that stops inside a clause. With
 * `wraps: false`, only `split` is checked.
 */
export function lineBreakFindings(file, text, { wraps = true } = {}) {
  const markdown = MARKDOWN.test(file);
  const lines = proseLines(text, markdown, HASH.test(file));
  const out = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const a = lines[i];
    const b = lines[i + 1];
    if (a.body === null || b.body === null || a.family !== b.family) continue;
    // A comment line that ends in a letter, then a continuation with no
    // space after its marker that starts in lower case.
    if (!markdown && /\p{L}$/u.test(a.body) && /^\p{Ll}/u.test(b.body)) {
      out.push({ kind: "split", quote: quote(a.body, b.body) });
      continue;
    }
    if (!wraps || a.raw.trimEnd().length < WRAP_MIN) continue;
    if (markdown && BLOCK_START.test(b.raw)) continue;
    if (!markdown && /^\s*@/.test(b.body)) continue;
    if (!/[\p{L}\p{N}`]$/u.test(a.body.trimEnd())) continue;
    const next = /^\s*(\p{Ll}[\p{L}'-]*)/u.exec(b.body)?.[1];
    if (!next || OPENERS.has(next)) continue;
    out.push({ kind: "wrap", quote: quote(a.body, b.body) });
  }
  return out;
}

/** The note for Claude about `findings` in `file`. */
export function findingsNote(file, findings) {
  const lines = findings
    .slice(0, MAX_FINDINGS)
    .map((f) =>
      f.kind === "split"
        ? `- A word is split between two lines: ${f.quote}.`
        : `- The line stops in a clause: ${f.quote}.`,
    );
  if (findings.length > MAX_FINDINGS)
    lines.push(`- ${findings.length - MAX_FINDINGS} more of the same.`);
  return [
    "<line_break_findings>",
    ...lines,
    "</line_break_findings>",
    `The text that you wrote in \`${file}\` has line breaks at a column width, not between sentences or clauses.`,
    "Put each sentence on a new line.",
    "Break a long sentence only between clauses, and never in a word.",
    "Examine the breaks in these findings, and correct each break that is wrong.",
    "If a finding is not correct, keep the text and tell the user.",
  ].join("\n");
}
