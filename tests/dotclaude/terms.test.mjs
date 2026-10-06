// dotclaude Terms of Use: each note to an agent is a clause, the plugins use
// the tags of the clause list, the wiki lists the same clauses, and the
// dotclaude-jev module adds the pick of Jev for clause 10.

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
import { pointer } from "../../plugins/dotclaude/lib/notes/handoff.mjs";
import {
  clauseTag,
  TERMS,
  TERMS_OF_USE,
} from "../../plugins/dotclaude/lib/terms.mjs";
import { CLAUSE_TAG } from "../../plugins/dotclaude-browser/hooks/session-start/add-browser-notes.mjs";
import { register } from "../../plugins/dotclaude-jev/hooks/module/index.mjs";

const root = join(import.meta.dir, "..", "..");
const read = (file) => readFileSync(join(root, file), "utf8");

test("each note of dotclaude is a clause", () => {
  const notes = {
    "cold-cache": [idleNote(400_000), resumeNote({})],
    handoff: [pointer({ name: "n.md", meta: {} }), handoffRow("/p/n.md").text],
    compaction: [COMPACT_TEXT],
    codegraph: [
      graphNote(
        { name: "f", kind: "function", filePath: "a.mjs", startLine: 1 },
        '{"callers":[{"name":"g","kind":"function"}]}',
      ),
    ],
  };
  for (const [id, texts] of Object.entries(notes))
    for (const text of texts) {
      expect(text.startsWith(clauseTag(id))).toBe(true);
      expect(text.endsWith("</dotclaude_terms>")).toBe(true);
    }
  expect(TERMS_OF_USE).not.toContain(";");
});

test("the plugins use the tags of the clause list", () => {
  expect(CLAUSE_TAG).toBe(clauseTag("browser"));
  expect(
    read("plugins/dotclaude-jev/hooks/session-start/second-opinion.md"),
  ).toStartWith(clauseTag("second-opinion"));
  expect(
    read("plugins/dotclaude-modder/hooks/session-start/game-modding.md"),
  ).toStartWith(clauseTag("game-modding"));
});

test("the wiki lists each clause with its number", () => {
  const page = read("wiki/Terms-of-Use.md");
  TERMS.forEach(({ title }, i) => {
    expect(page).toContain(`| ${i + 1} | ${title} |`);
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
