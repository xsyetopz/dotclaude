// dotclaude-jev: the `jev.mjs` request bodies, answer text, and retries,
// with a fake `fetch` (no call reaches the TypeSafe API).

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildBody,
  call,
  format,
  parseArgs,
  UsageError,
} from "../../plugins/dotclaude-jev/skills/second-opinion/scripts/jev.mjs";

const noStdin = () => {
  throw new Error("stdin read");
};
const body = (argv, stdin = noStdin) => buildBody(parseArgs(argv), stdin);

test("each verb builds its question type", () => {
  expect(body(["yes", "Is it safe?", "--state", "diff"])).toEqual({
    state: "diff",
    model: "jev-latest",
    questions: { q: { type: "noul", instructions: "Is it safe?" } },
  });
  expect(
    body(["PICK", "Which fix?", "a=Retry the call", "b"]).questions.q,
  ).toEqual({
    type: "choice",
    instructions: "Which fix?",
    criteria: { a: "Retry the call", b: null },
  });
  expect(body(["rate", "Risk?", "low", "high", "--state=x"])).toMatchObject({
    state: "x",
    questions: { q: { type: "score", criteria: ["low", "high"] } },
  });
});

test("the state comes from a file, stdin, or the text itself", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "jev-"));
  try {
    const file = path.join(dir, "state.txt");
    writeFileSync(file, "from file");
    expect(body(["yes", "Q", "--state", file]).state).toBe("from file");
    expect(body(["yes", "Q", "--state", "-"], () => "piped").state).toBe(
      "piped",
    );
    expect(body(["yes", "Q"]).state).toBe("");
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("`ask` takes the API questions, with or without the wrapper", () => {
  const questions = { x: { type: "noul", instructions: "Q" } };
  expect(body(["ask"], () => JSON.stringify(questions))).toEqual({
    state: "",
    model: "jev-latest",
    questions,
  });
  expect(
    body(["ask", "--state", "s"], () =>
      JSON.stringify({ state: "ignored", questions }),
    ).state,
  ).toBe("s");
});

test("the decision check asks for the kind and the soundness", () => {
  const file = path.join(
    import.meta.dirname,
    "../../plugins/dotclaude-jev/skills/second-opinion/decision.json",
  );
  const { questions } = body(["ask", "--state", "{}"], () =>
    readFileSync(file, "utf8"),
  );
  expect(questions.kind.type).toBe("choice");
  expect(Object.keys(questions.kind.criteria)).toEqual(["preference", "facts"]);
  expect(questions.sound.type).toBe("score");
  expect(questions.sound.criteria).toHaveLength(3);
});

test("bad input is a usage error", () => {
  for (const argv of [
    ["guess", "Q"],
    ["yes"],
    ["pick", "Q", "only"],
    ["rate", "Q", ...Array(11).fill("l")],
    ["ask", "--state", "-"],
  ])
    expect(() => body(argv, () => "{}")).toThrow(UsageError);
  expect(() => body(["ask"], () => "not json")).toThrow(UsageError);
});

test("the answer text lists probabilities and flags a weak answer", () => {
  expect(format("noul", { q: { noul: 0.95 } })).toBe("P(yes) = 0.95");
  expect(format("noul", { q: { noul: 0.55 } })).toContain("weak signal");
  const choice = format("choice", {
    q: { choice: "a", probabilities: { b: 0.1, a: 0.9 }, confidence: 0.8 },
  });
  expect(choice).toBe("a (confidence 0.80)\n  0.90 a\n  0.10 b");
  const score = format("score", {
    q: {
      score: 0.6,
      legend: { 0: "low", 1: "high" },
      probabilities: { 0: 0.4, 1: 0.6 },
      confidence: 0.1,
    },
  });
  expect(score).toContain("score 0.60 on levels 0 to 1");
  expect(score).toContain("0.60 1 high");
  expect(score).toContain("weak signal");
});

test("a 529 is retried with backoff, and a 401 names the key", async () => {
  const statuses = [529, 429, 200];
  const sent = [];
  const waits = [];
  const fetchFn = async (url, init) => {
    sent.push({ url, init });
    const status = statuses.shift();
    return new Response(JSON.stringify({ answers: {} }), { status });
  };
  const res = await call({ q: 1 }, "k", {
    fetchFn,
    sleep: async (ms) => waits.push(ms),
  });
  expect(res).toEqual({ answers: {} });
  expect(waits).toEqual([1000, 2000]);
  expect(sent[0].url).toBe("https://api.typesafe.ai/v1/systemone");
  expect(sent[0].init.headers.authorization).toBe("Bearer k");

  const denied = async () => new Response("no", { status: 401 });
  await expect(call({}, "k", { fetchFn: denied })).rejects.toThrow(
    "`TYPESAFE_API_KEY` is not valid",
  );
});

test("the session hook prints the note that sends decisions through Jev", () => {
  const dir = path.join(
    import.meta.dirname,
    "../../plugins/dotclaude-jev/hooks",
  );
  const hooks = JSON.parse(readFileSync(path.join(dir, "hooks.json"), "utf8"));
  const [cmd] = hooks.hooks.SessionStart[0].hooks;
  expect(cmd.args[0]).toEndWith("/hooks/second-opinion.md");
  const note = readFileSync(path.join(dir, "second-opinion.md"), "utf8");
  expect(note).toContain("`dotclaude-jev:second-opinion`");
  expect(note).toContain(
    "ask the user about goals, preferences, and approvals",
  );
  expect(note).not.toContain(";");
});
