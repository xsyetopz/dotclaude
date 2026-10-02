// Rules for the Edit/Write guard.
//
// check(toolName, toolInput, ctx) resolves to findings shaped [level, reason].

import { PROTECTED_REASON, protectedMatch } from "./_loop.mjs";
import { allowed } from "./_models.mjs";
import { pathFor } from "./_path.mjs";
import { parseYaml } from "./_yaml.mjs";

/**
 * `bashWrite` marks a file that a Bash command writes. The Bash guard owns
 * settings files for those, and a new file there is build output, not an edit.
 * `oracle` holds the agent loop's protected globs and the project root, set
 * only for a subagent. `io` gives host access.
 * @typedef {{io: import("./_io.mjs").Io, allowedModels: string[], env?: Record<string, string | undefined>, editGuard?: boolean, modelLock?: boolean, bashWrite?: boolean, oracle?: {root: string, globs: string[]}}} Context
 */

export async function check(toolName, toolInput, ctx) {
  const c = { editGuard: true, modelLock: true, ...ctx };
  const { io } = c;
  const path = pathFor(io.platform);
  const filePath = toolInput.file_path || toolInput.notebook_path || "";
  if (!filePath) return [];
  const posix = filePath.split(path.sep).join("/");
  const { before, after } = await beforeAfter(
    io,
    toolName,
    toolInput,
    filePath,
  );
  const out = [];
  if (!c.bashWrite && (isClaudeSettings(posix) || MANAGED_DROP_IN.test(posix)))
    out.push(...settings(before, after, c));
  if (!c.editGuard) return out;
  const glob =
    c.oracle &&
    protectedMatch(filePath, c.oracle.root, c.oracle.globs, c.oracle.platform);
  if (glob) out.push(["deny", PROTECTED_REASON(glob)]);
  if (TEST_PATH.test(posix)) out.push(...testWeakening(before, after));
  if (!c.bashWrite || (await io.fs.exists(filePath)))
    out.push(...(await generated(io, filePath, posix)));
  out.push(...(await frontmatter(io, toolName, toolInput, filePath, posix)));
  if (toolName === "Write" && before !== null)
    out.push(...shrink(before, after));
  return out;
}

/** Old text (null when the file is new) and new text for each editing tool. */
async function beforeAfter(io, toolName, input, filePath) {
  switch (toolName) {
    case "Edit":
      return { before: input.old_string ?? "", after: input.new_string ?? "" };
    case "MultiEdit": {
      const edits = Array.isArray(input.edits) ? input.edits : [];
      return {
        before: edits.map((e) => e.old_string ?? "").join("\n"),
        after: edits.map((e) => e.new_string ?? "").join("\n"),
      };
    }
    case "NotebookEdit":
      return { before: "", after: input.new_source ?? "" };
    default:
      return {
        before: await readExisting(io, filePath),
        after: input.content ?? "",
      };
  }
}

async function readExisting(io, filePath) {
  try {
    const stat = await io.fs.stat(filePath);
    return stat.kind === "file" && stat.size < 2_000_000
      ? await io.fs.read(filePath)
      : null;
  } catch {
    return null;
  }
}

function count(re, text) {
  return (
    text.match(new RegExp(re.source, `${re.flags.replace("g", "")}g`)) ?? []
  ).length;
}

// --- tests ------------------------------------------------------------------

const TEST_PATH =
  /(^|\/)(tests?|__tests__|spec|specs|testing)\/|(^|\/)test_[^/]+\.py$|_test\.(py|go|rs|exs?|dart)$|\.(test|spec)\.[cm]?[jt]sx?$|Tests?\.(swift|kt|java|cs)$|_spec\.rb$|Test\.php$/;
const ASSERT =
  /\bassert\w*\b|\bexpect\s*\(|XCTAssert\w*|#expect\b|#require\b|\bt\.(Error|Fatal|Fail)\w*\(|\brequire\.\w+\(|\.should\b|\bassert_(eq|ne)!|\bdebug_assert\w*!|\bAssert\.\w+\(|\bassertThat\(|\bverify\s*\(/;
const SKIP =
  /\b(it|test|describe|context)\.(skip|todo|only)\b|\b(xit|xdescribe|xtest|fit|fdescribe)\s*\(|@pytest\.mark\.(skip|xfail)|pytest\.skip\(|@unittest\.skip|\bself\.skipTest\(|#\[ignore\]|\bt\.Skip(Now|f)?\(|XCTSkip|\.disabled\(|@Disabled\b|@Ignore\b|\[Ignore\]|\[Fact\(Skip|\bskip:\s*true/;

// The user's latest message asks for tests to be removed ("rip out the flag,
// its tests, all of it"), so deleting assertions is the requested change.
export const ASKS_TEST_REMOVAL =
  /\b(remove|delete|drop|rip(\s+\w+)?\s+out|get\s+rid\s+of|strip)\b(?:(?!\.\s)[^\n]){0,80}\btests?\b|\btests?\b(?:(?!\.\s)[^\n]){0,40}\b(remove|delete|drop)\b/i;

function testWeakening(before, after) {
  // A new test file weakens nothing: conditional skips there are platform
  // guards such as `@unittest.skipUnless(shutil.which("openssl"))`.
  if (before === null) return [];
  const out = [];
  const removed = count(ASSERT, before ?? "") - count(ASSERT, after);
  // The Edit and Bash guards drop this finding when the user asked to remove
  // tests. A skip marker still asks: removing tests is not hiding a failing one.
  if (removed > 0)
    out.push([
      "ask",
      `the edit removes ${removed} assertion(s) from a test file`,
    ]);
  if (count(SKIP, after) > count(SKIP, before ?? ""))
    out.push([
      "ask",
      "the edit adds a skip, xfail, todo, or focus marker to a test file",
    ]);
  return out;
}

// --- Markdown frontmatter ---------------------------------------------------

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;

/** The whole file as this edit leaves it, or undefined when that is unknown. */
async function resultText(io, toolName, input, filePath) {
  if (toolName === "Write") return input.content ?? "";
  if (toolName !== "Edit" && toolName !== "MultiEdit") return undefined;
  let text = await readExisting(io, filePath);
  if (text === null) return undefined;
  const edits = toolName === "Edit" ? [input] : (input.edits ?? []);
  for (const e of edits) {
    const from = e.old_string ?? "";
    const to = e.new_string ?? "";
    if (!from || !text.includes(from)) return undefined;
    if (e.replace_all) text = text.split(from).join(to);
    else {
      const at = text.indexOf(from);
      text = text.slice(0, at) + to + text.slice(at + from.length);
    }
  }
  return text;
}

// Skill, agent, rule, and output-style files are read through their YAML
// frontmatter; an unquoted value containing ": " breaks the whole block.
async function frontmatter(io, toolName, input, filePath, posix) {
  if (!posix.endsWith(".md")) return [];
  const match = FRONTMATTER.exec(
    (await resultText(io, toolName, input, filePath)) ?? "",
  );
  if (!match) return [];
  const path = pathFor(io.platform);
  try {
    parseYaml(match[1]);
    return [];
  } catch (err) {
    return [
      [
        "deny",
        `the YAML frontmatter in \`${path.basename(filePath)}\` does not parse after this edit (${err.message}). Quote any value that contains \`: \` or starts with a special character, for example \`description: "…"\``,
      ],
    ];
  }
}

// --- generated files --------------------------------------------------------

const GENERATED_PATH =
  /\.min\.(js|css)$|(^|\/)(dist|build|out|target|\.next|node_modules|vendor|Pods|DerivedData)\/|\.(pb|pb\.gw)\.go$|_pb2(_grpc)?\.pyi?$|\.g\.dart$|\.freezed\.dart$|\.generated\.\w+$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|go\.sum|Package\.resolved|Podfile\.lock)$/;
const GENERATED_MARK = /@generated|DO NOT EDIT|auto-generated|autogenerated/i;

async function generated(io, filePath, posix) {
  const name = pathFor(io.platform).basename(filePath);
  if (GENERATED_PATH.test(posix))
    return [
      [
        "warn",
        `\`${name}\` is generated, vendored, or a lockfile. Usually, edit its source or rerun the generator instead`,
      ],
    ];
  let head = "";
  try {
    head = new TextDecoder()
      .decode(await io.fs.head(filePath, 1024))
      .split("\n")
      .slice(0, 5)
      .join("\n");
  } catch {
    head = "";
  }
  return GENERATED_MARK.test(head)
    ? [
        [
          "warn",
          `\`${name}\` is marked as generated. Usually, edit its source or rerun the generator instead`,
        ],
      ]
    : [];
}

function shrink(before, after) {
  const oldLines = before.split("\n").length;
  const newLines = after.split("\n").length;
  return oldLines >= 80 && newLines <= oldLines * 0.4
    ? [
        [
          "warn",
          `\`Write\` replaces a ${oldLines}-line file with ${newLines} lines`,
        ],
      ]
    : [];
}

// --- Claude settings --------------------------------------------------------

const SETTINGS_NAME =
  /(^|\/)(settings(\.local)?\.json|managed-settings\.json)$/;
const MANAGED_DROP_IN = /(^|\/)managed-settings\.d\/[^/]+\.json$/;
const FAST_DENY = "dotclaude's model lock disables fast mode";

function isClaudeSettings(posix) {
  return (
    SETTINGS_NAME.test(posix) &&
    (posix.includes("/.claude/") ||
      posix.includes("managed-settings") ||
      posix.includes("ClaudeCode"))
  );
}

function loads(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function settings(before, after, ctx) {
  const out = [];
  const parsed = loads(after);
  if (ctx.modelLock) {
    const fastOn = parsed
      ? parsed.fastMode === true
      : /"fastMode"\s*:\s*true/.test(after);
    const env = parsed?.env && typeof parsed.env === "object" ? parsed.env : {};
    const fastEnv =
      /"CLAUDE_CODE_DISABLE_FAST_MODE"\s*:\s*"0"/.test(after) ||
      (Object.hasOwn(env, "CLAUDE_CODE_DISABLE_FAST_MODE") &&
        String(env.CLAUDE_CODE_DISABLE_FAST_MODE) !== "1");
    if (fastOn || fastEnv) out.push(["deny", FAST_DENY]);
    for (const key of ["model", "advisorModel"]) {
      const value = parsed?.[key];
      if (
        typeof value === "string" &&
        !allowed(value, ctx.allowedModels, ctx.env)
      )
        out.push([
          "deny",
          `\`${key}: ${value}\` is outside the allowed models`,
        ]);
    }
  }
  if (
    /"disableAllHooks"\s*:\s*true/.test(after) &&
    !/"disableAllHooks"\s*:\s*true/.test(before ?? "")
  ) {
    out.push(["ask", "the edit disables all Claude Code hooks"]);
  }
  if (ctx.editGuard && !out.length)
    out.push(["ask", "the edit changes Claude Code settings"]);
  return out;
}
