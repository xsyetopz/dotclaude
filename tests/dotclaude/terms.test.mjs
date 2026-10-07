// The dotclaude operating spec: each note to an agent is a section of it,
// the plugins use the tags and rules of the section list,
// and the dotclaude-jev module adds the pick of Jev for the second opinion section.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  idleNote,
  resumeNote,
} from "../../plugins/dotclaude/lib/notes/cache.mjs";
import { graphNote } from "../../plugins/dotclaude/lib/notes/codegraph.mjs";
import {
  COMPACT_TEXT,
  handoffRow,
} from "../../plugins/dotclaude/lib/notes/compact.mjs";
import { handoffPointer } from "../../plugins/dotclaude/lib/notes/handoff.mjs";
import {
  cite,
  ruleNo,
  rules,
  ruleText,
  SECTIONS,
  SPEC,
  section,
  sectionTag,
} from "../../plugins/dotclaude/lib/terms.mjs";
import {
  LOAD_SKILL,
  SECTION_TAG,
} from "../../plugins/dotclaude-browser/hooks/session-start/add-browser-notes.mjs";
import { register } from "../../plugins/dotclaude-jev/hooks/module/index.mjs";

const root = join(import.meta.dir, "..", "..");
const read = (file) => readFileSync(join(root, file), "utf8");

test("each note of dotclaude is a section of the spec", () => {
  const notes = {
    "prompt-cache": [idleNote(400_000), resumeNote({})],
    handoffs: [handoffRow("/p/n.md").text, COMPACT_TEXT],
    codegraph: [
      graphNote(
        { name: "f", kind: "function", filePath: "a.mjs", startLine: 1 },
        '{"callers":[{"name":"g","kind":"function"}]}',
      ),
    ],
  };
  for (const [id, texts] of Object.entries(notes))
    for (const text of texts) {
      expect(text.startsWith(sectionTag(id))).toBe(true);
      expect(text.endsWith("</dotclaude_spec>")).toBe(true);
    }
});

test("the handoff pointer names the note and the skill", () => {
  const text = handoffPointer({ name: "n.md", meta: {} });
  expect(text).toContain(".claude/handoffs/n.md");
  expect(text).toContain("`dotclaude:handoff`");
});

test("the spec has no semicolon, and each section and rule id is unique", () => {
  const ids = SECTIONS.flatMap((s) => s.rules.map((r) => r.id));
  expect(new Set(ids).size).toBe(ids.length);
  expect(new Set(SECTIONS.map((s) => s.id)).size).toBe(SECTIONS.length);
  expect(SPEC).not.toContain(";");
  for (const { id, rules: list } of SECTIONS)
    expect(rules(id, { only: list.map((r) => r.id) })).not.toContain(";");
});

test("a rule number, its text, and its citation agree", () => {
  SECTIONS.forEach(({ id, rules: list }, i) => {
    expect(sectionTag(id)).toContain(`section="${i + 1}"`);
    list.forEach((rule, j) => {
      const no = `${i + 1}.${j + 1}`;
      expect(ruleNo(rule.id)).toBe(no);
      expect(ruleText(rule.id)).toStartWith(`${no} ${rule.level} `);
      expect(cite(rule.id)).toBe(
        `This is rule ${no} of the dotclaude operating spec.`,
      );
    });
  });
  expect(() => ruleNo("no-such-rule")).toThrow();
  expect(() => sectionTag("no-such-section")).toThrow();
});

test("a section wraps text in its tag, and `rules` leaves out late rules and rules of the other audience", () => {
  expect(section("working-rules", "x")).toBe(
    `${sectionTag("working-rules")}\nx\n</dotclaude_spec>`,
  );
  expect(rules("working-rules")).not.toContain(ruleText("edit-tools"));
  expect(rules("working-rules", { only: ["edit-tools"] })).toBe(
    ruleText("edit-tools"),
  );
  expect(rules("handoffs", { audience: "main" })).toContain(
    ruleText("handoff-write"),
  );
  expect(rules("handoffs", { audience: "subagent" })).not.toContain(
    ruleText("handoff-write"),
  );
});

test("the plugins use the tags and rules of the section list", () => {
  expect(SECTION_TAG).toBe(sectionTag("browser"));
  expect(LOAD_SKILL).toBe(ruleText("browser-skill"));
  const opinion = read(
    "plugins/dotclaude-jev/hooks/session-start/second-opinion.md",
  );
  expect(opinion).toStartWith(sectionTag("second-opinion"));
  for (const { id, level } of SECTIONS.find((s) => s.id === "second-opinion")
    .rules)
    expect(opinion).toContain(`${ruleNo(id)} ${level} `);
  expect(
    read("plugins/dotclaude-modder/hooks/session-start/game-modding.md"),
  ).toBe(`${section("game-modding", rules("game-modding"))}\n`);
});

test("the wiki lists each section with its number and title", () => {
  const page = read("wiki/Operating-Spec.md");
  SECTIONS.forEach(({ title }, i) => {
    expect(page).toContain(`${i + 1}`);
    expect(page).toContain(title);
  });
});

/**
 * Runs the dotclaude-jev module on `e` with a fake `$` (a test double).
 * `run` stands in for `$.process.run`, so no test calls Jev.
 */
async function jev(e, { key = "k", run } = {}) {
  let handler;
  register((event, fn) => {
    if (event === "tool.call") handler = fn;
  });
  const runs = [];
  const $ = {
    plugin: { root: "/p" },
    env: { get: async (name) => (name === "TYPESAFE_API_KEY" ? key : "") },
    process: {
      run: async (argv, init) => {
        runs.push({ argv, init });
        return run();
      },
    },
  };
  let passed;
  await handler($, e, async (changed) => {
    passed = changed;
    return { result: "ok" };
  });
  return { passed, runs };
}

const ASK = {
  tool: "AskUserQuestion",
  questions: [
    {
      question: "Which hash for passwords?",
      header: "Hash",
      multiSelect: false,
      options: [
        { label: "argon2id", description: "Memory-hard" },
        { label: "md5", description: "Fast" },
      ],
    },
    {
      question: "Which name for the module?",
      header: "Name",
      multiSelect: false,
      options: [
        { label: "auth", description: "Short" },
        { label: "login", description: "Plain" },
      ],
    },
  ],
};

/** A fake `jev.mjs ask` output (a test double). */
const answers = (kind0, pickConfidence = 0.9) => ({
  exitCode: 0,
  stderr: "",
  stdout: JSON.stringify({
    kind_0: { choice: kind0, confidence: 0.9 },
    pick_0: { choice: "argon2id", confidence: pickConfidence },
    kind_1: { choice: "preference", confidence: 0.9 },
    pick_1: { choice: "auth", confidence: 0.9 },
  }),
});

test("a question that facts decide gets the pick of Jev", async () => {
  const { passed, runs } = await jev(ASK, { run: () => answers("facts") });
  expect(runs).toHaveLength(1);
  expect(runs[0].argv.slice(0, 3)).toEqual([
    "bun",
    "/p/skills/second-opinion/scripts/jev.mjs",
    "ask",
  ]);
  expect(Object.keys(JSON.parse(runs[0].init.stdin).questions)).toEqual([
    "kind_0",
    "pick_0",
    "kind_1",
    "pick_1",
  ]);
  expect(passed.questions[0].question).toBe(
    'Which hash for passwords?\n\nJev picks "argon2id" (confidence 0.90).',
  );
  expect(passed.questions[0].options).toEqual(ASK.questions[0].options);
  expect(passed.questions[1]).toEqual(ASK.questions[1]);
});

test("a preference question or a weak pick stays as it is", async () => {
  for (const run of [() => answers("preference"), () => answers("facts", 0.3)])
    expect((await jev(ASK, { run })).passed).toEqual(ASK);
});

test("without a key, or when Jev fails, the question passes unchanged", async () => {
  const none = await jev(ASK, { key: "", run: () => answers("facts") });
  expect(none.runs).toHaveLength(0);
  expect(none.passed).toBe(ASK);
  for (const run of [
    () => ({ exitCode: 2, stdout: "", stderr: "no key" }),
    () => ({ exitCode: 0, stdout: "not json", stderr: "" }),
    () => {
      throw new Error("bun is missing");
    },
  ])
    expect((await jev(ASK, { run })).passed).toBe(ASK);
});

test("other tools pass unchanged", async () => {
  const bash = { tool: "Bash", command: "ls" };
  const { passed, runs } = await jev(bash, { run: () => answers("facts") });
  expect(passed).toBe(bash);
  expect(runs).toHaveLength(0);
});
