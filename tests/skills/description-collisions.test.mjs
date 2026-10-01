// Claude picks a skill or an agent from its name and description only. Two
// descriptions with most words in common make it pick the wrong one. This test
// scores each pair by TF-IDF cosine similarity. The method and the 0.5 limit
// come from addyosmani/agent-skills `scripts/run-evals.js` (MIT), reimplemented
// here, with no code copied.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const LIMIT = 0.5;

const STOP = new Set(
  "a an and any are as at be before by for from in into is it its my need needs of on or our so that the them this to use want we when with you your help me i not".split(
    " ",
  ),
);

function stem(word) {
  let t = word;
  for (const suffix of ["ally", "ing", "ed", "es", "al"])
    if (t.length > suffix.length + 3 && t.endsWith(suffix)) {
      t = t.slice(0, -suffix.length);
      break;
    }
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  if (t.length > 4 && t.endsWith("e")) t = t.slice(0, -1);
  if (t.length > 4 && t.at(-1) === t.at(-2) && !"aeiou".includes(t.at(-1)))
    t = t.slice(0, -1);
  if (t.length > 3 && t.endsWith("y")) t = `${t.slice(0, -1)}i`;
  return t;
}

const tokens = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
    .map(stem);

/** Pairs of entries whose similarity is `LIMIT` or more, most similar first. */
function collisions(entries) {
  const docs = entries.map(({ name, description }) => {
    const nameTokens = tokens(name);
    const tf = new Map();
    for (const t of [...nameTokens, ...nameTokens, ...tokens(description)])
      tf.set(t, (tf.get(t) ?? 0) + 1);
    return tf;
  });
  const df = new Map();
  for (const tf of docs)
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t) => Math.log(1 + docs.length / (1 + df.get(t)));
  const vectors = docs.map(
    (tf) => new Map([...tf].map(([t, f]) => [t, f * idf(t)])),
  );
  const norm = (v) => Math.sqrt([...v.values()].reduce((s, w) => s + w * w, 0));
  const found = [];
  for (let i = 0; i < vectors.length; i++)
    for (let j = i + 1; j < vectors.length; j++) {
      let dot = 0;
      for (const [t, w] of vectors[i]) dot += w * (vectors[j].get(t) ?? 0);
      const sim = dot / (norm(vectors[i]) * norm(vectors[j]) || 1);
      if (sim >= LIMIT)
        found.push(
          `${entries[i].name} ~ ${entries[j].name}: ${sim.toFixed(2)}`,
        );
    }
  return found.sort((a, b) => b.split(": ")[1] - a.split(": ")[1]);
}

function frontmatter(file) {
  const head = fs.readFileSync(file, "utf8").split(/^---$/m)[1] ?? "";
  const field = (key) =>
    head
      .match(new RegExp(`^${key}:\\s*(.*)$`, "m"))?.[1]
      .trim()
      .replace(/^(["'])(.*)\1$/, "$2");
  return { name: field("name"), description: field("description") };
}

function catalog() {
  const files = [];
  for (const base of [ROOT, path.join(ROOT, "plugins/dotclaude-browser")]) {
    const skills = path.join(base, "skills");
    for (const name of fs.readdirSync(skills))
      if (fs.existsSync(path.join(skills, name, "SKILL.md")))
        files.push(path.join(skills, name, "SKILL.md"));
    const agents = path.join(base, "agents");
    if (fs.existsSync(agents))
      for (const name of fs.readdirSync(agents))
        if (name.endsWith(".md")) files.push(path.join(agents, name));
  }
  return files.map(frontmatter);
}

test("no two skill or agent descriptions are near-duplicates", () => {
  const entries = catalog();
  expect(entries.length).toBeGreaterThan(10);
  for (const entry of entries)
    expect(entry.description, entry.name).toBeTruthy();
  expect(collisions(entries)).toEqual([]);
});

test("a near-duplicate pair is reported", () => {
  expect(
    collisions([
      {
        name: "review-code",
        description:
          "Reviews a diff for bugs. Use when the user asks for a code review.",
      },
      {
        name: "code-review",
        description:
          "Reviews code in a diff for bugs. Use when asked to review code.",
      },
      {
        name: "handoff",
        description: "Writes a note so a fresh session can continue the task.",
      },
    ]),
  ).toEqual([expect.stringMatching(/^review-code ~ code-review: /)]);
});
