// The verify gate: did the turn edit files and then run no check?
// No shell parser: a check command is found by a word match in the command.

const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

// A recipe, script, or target with one of these names checks the work.
const CHECK_NAME =
  /^(check|test|tests|lint|typecheck|type-check|verify|ci|validate|build)([:_-].*)?$/;

// Runners that need no project file.
const RUNNERS = [
  "bun test",
  "npm test",
  "pnpm test",
  "yarn test",
  "pytest",
  "cargo test",
  "go test",
];

/** The recipe names of a justfile or the targets of a Makefile. */
const names = (text, pattern) =>
  [...text.matchAll(pattern)]
    .map((m) => m[1])
    .filter((n) => CHECK_NAME.test(n));

/**
 * The check commands of a project, from the text of its `justfile`,
 * `package.json`, and `Makefile` (each may be empty).
 */
export function checkCommands({
  justfile = "",
  packageJson = "",
  makefile = "",
}) {
  let scripts = [];
  try {
    scripts = Object.keys(JSON.parse(packageJson || "{}").scripts ?? {});
  } catch {
    // A package.json that is not JSON names no script.
  }
  return [
    ...names(justfile, /^@?([A-Za-z_][\w-]*)[^\n:=]*:(?!=)/gm).map(
      (r) => `just ${r}`,
    ),
    ...scripts
      .filter((s) => CHECK_NAME.test(s))
      .flatMap((s) =>
        ["bun", "npm", "pnpm", "yarn"].map((m) => `${m} run ${s}`),
      ),
    ...names(makefile, /^([A-Za-z_][\w-]*)\s*:(?!=)/gm).map((t) => `make ${t}`),
    ...RUNNERS,
  ];
}

/** Whether `command` runs one of `candidates`, as whole words. */
export const runsCheck = (command, candidates) =>
  candidates.some((c) =>
    new RegExp(
      `(^|[\\s;&|(])${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w:.-])`,
    ).test(command),
  );

/**
 * The tool uses of the last turn in a transcript's JSONL text: `{ name,
 * command }` in order. The turn starts at the last user line that is not a
 * tool result.
 */
export function lastTurn(jsonl) {
  const lines = jsonl.split("\n").flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
  const blocks = (m) =>
    Array.isArray(m.message?.content) ? m.message.content : [];
  const isPrompt = (m) =>
    m.type === "user" &&
    !m.isSidechain &&
    (typeof m.message?.content === "string" ||
      blocks(m).some((b) => b.type === "text"));
  const start = lines.findLastIndex(isPrompt);
  return lines
    .slice(start + 1)
    .filter((m) => m.type === "assistant" && !m.isSidechain)
    .flatMap(blocks)
    .filter((b) => b.type === "tool_use")
    .map((b) => ({ name: b.name, command: String(b.input?.command ?? "") }));
}

/** The reason to send Claude back, or undefined. */
export function verifyReason(uses, commands) {
  const edit = uses.findLastIndex((u) => EDITS.has(u.name));
  if (edit < 0) return undefined;
  const ran = uses
    .slice(edit + 1)
    .some((u) => u.name === "Bash" && runsCheck(u.command, commands));
  if (ran) return undefined;
  const named = commands
    .slice(0, 6)
    .map((c) => `\`${c}\``)
    .join(", ");
  return `You edited files in this turn, and no check ran after the last edit. Run a check that covers the change, for example ${named}. If no check can run, say that the change is not verified.`;
}
