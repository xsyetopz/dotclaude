// The files a parsed Bash command writes without the edit tools: redirects,
// tee, in-place editors, copies and moves, and interpreter code that opens a
// file for writing. The stop gate counts these as edits, and the Bash guard
// sends them through the Edit rules.

import fs from "node:fs";
import path from "node:path";
import { positional } from "./_bash-args.mjs";

const IN_PLACE = /^(sed|gsed|perl)$/;
const INTERPRETER = /^(python[0-9.]*|node|bun|deno|ruby|perl)$/;
// Write calls in inline interpreter code whose first argument is a string
// literal: `open('f', 'w')`, `Path('f').write_text(`, `writeFileSync('f'`.
// The path argument: a plain, raw, or bytes string literal, or a variable that
// a simple assignment in the same code sets to one. f-strings and other
// computed paths are skipped, since their value is unknown.
const LITERAL = String.raw`\s*(?:[rRbBuU]?'([^'\\\n]*)'|[rRbBuU]?"([^"\\\n]*)"|([A-Za-z_]\w*)(?=\s*[,)]))`;
const ASSIGN =
  /(?:^|[\s;(])(?:const\s+|let\s+|var\s+)?([A-Za-z_]\w*)\s*=\s*[rRbBuU]?(?:'([^'\\\n]*)'|"([^"\\\n]*)")/gm;
const WRITE_CALLS = [
  [String.raw`\bopen\(`, String.raw`\s*,\s*(?:mode\s*=\s*)?["'][wax]`],
  [String.raw`\bPath\(`, String.raw`\s*\)\.write_(?:text|bytes)\(`],
  [String.raw`\bwriteFileSync\(`, ""],
  [String.raw`\bfs\.(?:promises\.)?writeFile\(`, ""],
  [String.raw`\bBun\.write\(`, ""],
  [String.raw`\bFile\.write\(`, ""],
  [String.raw`\b(?:os|ioutil)\.WriteFile\(`, ""],
].map(([call, rest]) => new RegExp(call + LITERAL + rest, "g"));
// `p = pathlib.Path("f")` as a whole statement, then `p.write_text(`. A path
// joined after the call (`Path('src') / 'x'`) is not the file, so it is skipped.
const PATH_ASSIGN =
  /(?:^|[\s;(])([A-Za-z_]\w*)\s*=\s*(?:pathlib\.)?Path\(\s*[rRbBuU]?(?:'([^'\\\n]*)'|"([^"\\\n]*)")\s*\)[ \t]*(?=[;\n#]|$)/gm;
const PATH_WRITE = /\b([A-Za-z_]\w*)\.write_(?:text|bytes)\(/g;

function inlineWrites(code) {
  const vars = new Map();
  for (const m of code.matchAll(ASSIGN)) vars.set(m[1], m[2] ?? m[3]);
  const paths = new Map();
  for (const m of code.matchAll(PATH_ASSIGN)) paths.set(m[1], m[2] ?? m[3]);
  return [
    ...WRITE_CALLS.flatMap((re) =>
      [...code.matchAll(re)].map((m) => m[1] ?? m[2] ?? vars.get(m[3])),
    ),
    ...[...code.matchAll(PATH_WRITE)].map((m) => paths.get(m[1])),
  ].filter((target) => target !== undefined);
}

export const expandHome = (p) =>
  p.replace(/^~(?=\/|$)/, process.env.HOME ?? "~");

/**
 * The directory a command runs in after an earlier `cd`, or undefined when
 * that is unknown (`cd $DIR`, or `~` without HOME).
 */
export function commandBase(cmd, cwd) {
  const hint = cmd.cwdHint;
  if (!hint) return cwd;
  if (hint.includes("$")) return undefined;
  if (hint.startsWith("~") && !/^~(\/|$)/.test(hint)) return undefined;
  if (hint.startsWith("~") && !process.env.HOME) return undefined;
  return path.resolve(cwd, expandHome(hint));
}

/**
 * Write targets of one parsed command, as written in the command, in order.
 * `content` is the whole new file text when the command states it: a heredoc
 * that `cat` or `tee` writes over the target. Otherwise it is undefined.
 * @returns {{target: string, content?: string}[]}
 */
export function writeTargets(cmd, base) {
  const out = [];
  const whole =
    cmd.heredoc !== null &&
    (cmd.name === "cat" || cmd.name === "tee") &&
    !cmd.args.some((a) => a === "-a" || a === "--append");
  for (const t of cmd.writes)
    out.push({
      target: t,
      content:
        whole && cmd.name === "cat" && !positional(cmd.args).length
          ? cmd.overwrites.includes(t)
            ? cmd.heredoc
            : undefined
          : undefined,
    });
  const operands = cmd.args.filter((a) => a && !a.startsWith("-"));
  if (IN_PLACE.test(cmd.name) && cmd.args.some((a) => /^-[a-zA-Z]*i/.test(a))) {
    // `sed -i '' 's/a/b/' f` and `perl -pi -e '...' f`: the first operand is
    // the script unless -e gave it, and only existing files count.
    const scriptGiven = cmd.args.some((a) => /^-[a-zA-Z]*e$/.test(a));
    for (const t of operands.slice(scriptGiven ? 0 : 1))
      if (base && fs.existsSync(path.resolve(base, expandHome(t))))
        out.push({ target: t });
  }
  if (cmd.name === "sd")
    for (const t of operands.slice(2)) out.push({ target: t });
  if (cmd.name === "tee")
    for (const t of operands)
      out.push({ target: t, content: whole ? cmd.heredoc : undefined });
  if (["mv", "cp", "install"].includes(cmd.name) && operands.length > 1)
    out.push({ target: operands.at(-1) });
  if (INTERPRETER.test(cmd.name))
    for (const t of inlineWrites([cmd.heredoc ?? "", ...cmd.args].join("\n")))
      out.push({ target: t });
  return out;
}
