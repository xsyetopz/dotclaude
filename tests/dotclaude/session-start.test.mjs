import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  contextFor,
  needsIndex,
  setupNotice,
} from "../../plugins/dotclaude/hooks/session-start/add-session-context.mjs";
import {
  COLD_RESUME_MIN_TOKENS,
  MINIMAL_CODE_MAX_BYTES,
  RULES_MAX_BYTES,
} from "../../plugins/dotclaude/lib/budget.mjs";
import {
  rules,
  SPEC,
  section,
  sectionTag,
} from "../../plugins/dotclaude/lib/terms.mjs";

const RULES = section("working-rules", rules("working-rules"));
const MINIMAL_CODE = section("minimal-code", rules("minimal-code"));

function project(notes) {
  const root = mkdtempSync(join(tmpdir(), "ss-"));
  mkdirSync(join(root, ".claude/handoffs"), { recursive: true });
  for (const [name, status] of Object.entries(notes))
    writeFileSync(
      join(root, ".claude/handoffs", name),
      `---\nstatus: ${status}\nwritten: 2026-10-04T00:00:00Z\n---\n\nbody\n`,
    );
  return root;
}

test("the working rules stay within their byte limit and keep semicolons out", () => {
  expect(Buffer.byteLength(RULES)).toBeLessThanOrEqual(RULES_MAX_BYTES);
  expect(RULES).not.toContain(";");
});

test("the line break rule asks for semantic line breaks, not column breaks", () => {
  const text = rules("line-breaks");
  expect(text).toContain("start each sentence of prose on a new line");
  expect(text).toContain("break a long one only between clauses");
});

test("startup, clear, and compact add the spec sections", () => {
  const root = project({});
  for (const source of ["startup", "clear", "compact"]) {
    const [first, ...rest] = contextFor({ source }, root);
    expect(first).toBe(`${SPEC}\n\n${RULES}`);
    expect(rest).toContain(MINIMAL_CODE);
    const longRuns = rest.find((p) => p.startsWith(sectionTag("long-runs")));
    expect(longRuns).toBe(section("long-runs", rules("long-runs")));
    expect(longRuns).toContain("time one run before a loop");
    expect(rest.find((p) => p.startsWith(sectionTag("questions")))).toBe(
      section("questions", rules("questions")),
    );
    expect(rest.find((p) => p.startsWith(sectionTag("known-defects")))).toBe(
      section("known-defects", rules("known-defects")),
    );
  }
  expect(contextFor({ source: "resume" }, root)).toEqual([]);
});

test("startup and clear point at the newest in-progress note only", () => {
  const root = project({
    "2026-10-01-0900-a.md": "in-progress",
    "2026-10-03-0900-b.md": "in-progress",
    "2026-10-04-0900-c.md": "done",
  });
  const pointer = contextFor({ source: "startup" }, root).at(-1);
  expect(pointer).toContain("2026-10-03-0900-b.md");
  expect(pointer).not.toContain("2026-10-04-0900-c.md");
  expect(pointer).not.toContain("2026-10-01-0900-a.md");
  const base = contextFor({ source: "compact" }, root);
  expect(base).not.toContain(pointer);
  expect(contextFor({ source: "startup" }, root)).toEqual([...base, pointer]);
  expect(
    contextFor({ source: "startup" }, project({ "a.md": "done" })),
  ).toEqual(base);
});

test("the minimal code rules are on unless the plugin option is false", () => {
  expect(Buffer.byteLength(MINIMAL_CODE)).toBeLessThanOrEqual(
    MINIMAL_CODE_MAX_BYTES,
  );
  expect(MINIMAL_CODE).not.toContain(";");
  const root = project({});
  const parts = (option) =>
    contextFor({ source: "startup" }, root, "max20", option);
  expect(parts(undefined)).toContain(MINIMAL_CODE);
  expect(parts("true")).toContain(MINIMAL_CODE);
  expect(parts("false")).not.toContain(MINIMAL_CODE);
});

test("a git repository without a CodeGraph index needs one when `codegraph` runs", () => {
  const root = project({});
  // Fakes of `run` (test doubles): one with `codegraph`, one without.
  const cli = () => "1.6.0";
  const noCli = () => null;
  expect(needsIndex(root, cli)).toBe(false);
  mkdirSync(join(root, ".git"));
  expect(needsIndex(root, cli)).toBe(true);
  expect(needsIndex(root, noCli)).toBe(false);
  mkdirSync(join(root, ".codegraph"));
  expect(needsIndex(root, cli)).toBe(false);
});

test("the CodeGraph option set to false leaves out the init note", () => {
  const root = project({});
  mkdirSync(join(root, ".git"));
  const text = contextFor(
    { source: "startup" },
    root,
    "max20",
    undefined,
    "false",
  ).join("\n");
  expect(text).not.toContain(sectionTag("codegraph"));
});

test("a resume with an expired cache names the cost and the advice", () => {
  const data = {
    source: "resume",
    prompt_cache_likely_expired: true,
    estimated_cache_write_usd: 1.234,
  };
  const [note] = contextFor(data, "/x");
  expect(note).toContain("$1.23");
  expect(note).toContain("estimated_cache_write_usd");
  expect(note).toContain("`/clear`");
  expect(
    contextFor({ ...data, prompt_cache_likely_expired: false }, "/x"),
  ).toEqual([]);
});

test("a resume with a small context gets no cold cache note", () => {
  const data = { source: "resume", prompt_cache_likely_expired: true };
  const at = (tokens) => contextFor({ ...data, context_tokens: tokens }, "/x");
  expect(at(COLD_RESUME_MIN_TOKENS - 1)).toEqual([]);
  expect(at(COLD_RESUME_MIN_TOKENS)).toHaveLength(1);
  expect(contextFor(data, "/x")).toHaveLength(1);
});

test("startup tells the user once per version when the setup is stale", () => {
  const dir = mkdtempSync(join(tmpdir(), "ss-setup-"));
  const { version } = JSON.parse(
    readFileSync(
      join(
        import.meta.dir,
        "../../plugins/dotclaude/.claude-plugin/plugin.json",
      ),
    ),
  );
  writeFileSync(join(dir, "settings.json"), '{"autoCompactWindow": 200000}');
  const note = setupNotice(dir, "max20");
  expect(note).toContain(version);
  expect(note).toContain("the `CLAUDE.md` block");
  expect(note).toContain("/dotclaude:setup");
  expect(setupNotice(dir, "max20")).toBeNull();
  writeFileSync(join(dir, "dotclaude/setup-noticed"), "0.0.1\n");
  expect(setupNotice(dir, "max20")).toContain(version);
});

test("startup gives no setup note after the setup scripts ran", () => {
  const dir = mkdtempSync(join(tmpdir(), "ss-setup-"));
  for (const script of ["settings.mjs", "claude-md.mjs"])
    Bun.spawnSync(
      [
        "bun",
        join(
          import.meta.dir,
          "../../plugins/dotclaude/skills/setup/scripts",
          script,
        ),
        "--plan",
        "max20",
        "--apply",
      ],
      { env: { ...process.env, CLAUDE_CONFIG_DIR: dir } },
    );
  expect(setupNotice(dir, "max20")).toBeNull();
});

test("startup tells the user when a status line launcher is old or missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "ss-setup-"));
  Bun.spawnSync(
    [
      "bun",
      join(
        import.meta.dir,
        "../../plugins/dotclaude/skills/setup/scripts/settings.mjs",
      ),
      "--plan",
      "max20",
      "--apply",
    ],
    { env: { ...process.env, CLAUDE_CONFIG_DIR: dir } },
  );
  writeFileSync(join(dir, "CLAUDE.md"), "");
  const fresh = () => {
    rmSync(join(dir, "dotclaude/setup-noticed"), { force: true });
    return setupNotice(dir, "max20");
  };
  const block = "the `CLAUDE.md` block";
  expect(fresh()).toContain(block);
  expect(fresh()).not.toContain("launcher");
  // The text of 0.21.0 and older has the script of one version as a fallback.
  writeFileSync(
    join(dir, "dotclaude/statusline.mjs"),
    'let script = "/cache/dotclaude/dotclaude/0.21.0/status-line/main.mjs";\n',
  );
  expect(fresh()).toContain("1 status line launcher");
  rmSync(join(dir, "dotclaude/subagent-statusline.mjs"));
  expect(fresh()).toContain(`${block} and 2 status line launchers`);
});
