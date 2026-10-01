// evals/oracle.mjs: the post-run test oracle and the token split.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { grade, runTokens } from "../../evals/oracle.mjs";

// A kept run as `claude plugin eval --keep-temp` leaves it: the workspace in
// `home/cwd` and the stream-json trace in `out/trace.jsonl`.
function keptRun(tmp, name, answer) {
  const root = path.join(tmp, name);
  fs.mkdirSync(path.join(root, "home", "cwd"), { recursive: true });
  fs.mkdirSync(path.join(root, "out"));
  fs.writeFileSync(path.join(root, "home", "cwd", "answer.txt"), answer);
  const trace = path.join(root, "out", "trace.jsonl");
  fs.writeFileSync(
    trace,
    [
      JSON.stringify({ type: "assistant", message: { usage: {} } }),
      JSON.stringify({
        type: "result",
        usage: {
          input_tokens: 10,
          output_tokens: 200,
          cache_read_input_tokens: 5000,
          cache_creation_input_tokens: 1500,
        },
      }),
    ].join("\n"),
  );
  return {
    passed: true,
    tracePath: trace,
    error: null,
    graders: [{ name: "said", passed: true, scored: true }],
  };
}

function suite() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eval-oracle-"));
  const caseDir = path.join(tmp, "evals", "t1");
  fs.mkdirSync(caseDir, { recursive: true });
  // The oracle reads a file of its own case through ORACLE_DIR.
  fs.writeFileSync(path.join(caseDir, "expected.txt"), "42");
  fs.writeFileSync(
    path.join(caseDir, "oracle.sh"),
    'test "$(cat answer.txt)" = "$(cat "$ORACLE_DIR/expected.txt")"\n',
  );
  fs.mkdirSync(path.join(tmp, "evals", "talk"));
  const result = {
    cases: [
      {
        name: "t1",
        dir: "evals/t1",
        arms: {
          with: [keptRun(tmp, "a", "42"), keptRun(tmp, "b", "41")],
          without: [{ passed: false, tracePath: "", error: "timeout" }],
        },
      },
      {
        name: "talk",
        dir: "evals/talk",
        arms: { with: [keptRun(tmp, "c", "x")] },
      },
    ],
  };
  return { tmp, result };
}

test("the oracle grader passes only when the oracle exits 0 in the workspace", () => {
  const { tmp, result } = suite();
  expect(grade(result, tmp)).toEqual([]);
  const [good, bad] = result.cases[0].arms.with;
  expect(good.graders.at(-1)).toMatchObject({ name: "oracle", passed: true });
  expect(good.passed).toBe(true);
  expect(bad.graders.at(-1)).toMatchObject({ name: "oracle", passed: false });
  expect(bad.passed).toBe(false);
  expect(result.cases[0].arms.without[0].graders.at(-1)).toMatchObject({
    name: "oracle",
    passed: false,
  });
  // A case without an oracle keeps its graders.
  expect(result.cases[1].arms.with[0].graders).toHaveLength(1);
  // The oracle ran in a copy: the kept workspace is unchanged, and a second
  // pass replaces the grader instead of adding one.
  grade(result, tmp);
  expect(good.graders.filter((g) => g.name === "oracle")).toHaveLength(1);
  expect(fs.readdirSync(path.join(tmp, "a", "home", "cwd"))).toEqual([
    "answer.txt",
  ]);
});

test("each run gets the token split of its trace's result event", () => {
  const { tmp, result } = suite();
  grade(result, tmp);
  expect(result.cases[1].arms.with[0].tokens).toEqual({
    input: 10,
    output: 200,
    cacheRead: 5000,
    cacheWrite: 1500,
  });
  expect(runTokens(path.join(tmp, "none.jsonl"))).toBeNull();
});

test("a run whose workspace was not kept is reported, not scored", () => {
  const { tmp, result } = suite();
  fs.rmSync(path.join(tmp, "b"), { recursive: true });
  expect(grade(result, tmp)).toEqual(["t1 with #2"]);
});

test("a sealed kept run is scored, and its seal is restored", () => {
  // When the plugin wrote to `home/` or `tmp/`, the CLI moves them into
  // `sealed/` with mode 000 and makes the kept folder read-only.
  const { tmp, result } = suite();
  const root = path.join(tmp, "a");
  fs.mkdirSync(path.join(root, "sealed"));
  fs.renameSync(path.join(root, "home"), path.join(root, "sealed", "home"));
  fs.chmodSync(path.join(root, "sealed"), 0o000);
  fs.chmodSync(root, 0o500);
  expect(grade(result, tmp)).toEqual([]);
  const good = result.cases[0].arms.with[0];
  expect(good.graders.at(-1)).toMatchObject({ name: "oracle", passed: true });
  expect(fs.statSync(path.join(root, "sealed")).mode & 0o777).toBe(0);
  expect(fs.statSync(root).mode & 0o777).toBe(0o500);
  // The test cleanup cannot remove a sealed folder.
  fs.chmodSync(root, 0o700);
  fs.chmodSync(path.join(root, "sealed"), 0o700);
});
