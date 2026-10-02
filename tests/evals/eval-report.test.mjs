// Statistics in evals/report.mjs.

import { expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  armCost,
  armRates,
  meanSe,
  trialPassed,
  wilson,
} from "../../evals/report.mjs";

const near = (a, b) =>
  expect(Math.abs(a - b) < 0.005, `${a} vs ${b}`).toBeTruthy();

test("wilson interval matches the textbook values", () => {
  const [lo, hi] = wilson(3, 3);
  near(lo, 0.4385);
  near(hi, 1);
  const [lo2, hi2] = wilson(5, 10);
  near(lo2, 0.2366);
  near(hi2, 0.7634);
});

test("meanSe gives the standard error of the mean", () => {
  const { mean, se } = meanSe([1, 0, 1, 0]);
  near(mean, 0.5);
  near(se, 0.2887);
  expect(Number.isNaN(meanSe([1]).se)).toBeTruthy();
});

test("a trial passes only when every scored grader passed", () => {
  const run = (graders) => ({ graders });
  expect(
    trialPassed(run([{ name: "a", passed: true, scored: true }])),
  ).toBeTruthy();
  expect(
    !trialPassed(
      run([
        { name: "a", passed: true, scored: true },
        { name: "b", passed: false, scored: true },
      ]),
    ),
  ).toBeTruthy();
  expect(
    trialPassed(
      run([
        { name: "a", passed: true, scored: true },
        { name: "b", passed: false, scored: false },
      ]),
    ),
  ).toBeTruthy();
  expect(
    trialPassed(
      run([
        { name: "a", passed: true, scored: true },
        { name: "b", passed: false, scored: true },
      ]),
      new Set(["b"]),
    ),
  ).toBeTruthy();
});

test("cost per pass counts the spend of failed trials", () => {
  const run = (costUsd, passed, tokens) => ({
    costUsd,
    tokens,
    graders: [{ name: "a", passed, scored: true }],
  });
  const t = { input: 10, output: 100, cacheRead: 1000, cacheWrite: 300 };
  const result = {
    cases: [
      { arms: { with: [run(1, true, t), run(2, false, t)] } },
      { arms: { with: [run(3, true)], without: [run(0.5, false)] } },
    ],
  };
  expect(armCost(result, "with")).toEqual({
    trials: 3,
    passes: 2,
    spend: 6,
    perPass: 3,
    tokens: t,
  });
  expect(armCost(result, "without").perPass).toBeNull();
});

test("a comparison without the case files warns instead of scoring with-only graders", () => {
  const result = {
    cases: [
      {
        name: "gone",
        dir: "evals/no-such-case",
        arms: {
          without: [
            {
              graders: [
                { name: "fired", passed: false, withOnly: false },
                { name: "works", passed: true },
              ],
            },
          ],
        },
      },
    ],
  };
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(
      armRates(result, "without", "/nonexistent", true).get("gone"),
    ).toEqual({
      k: 0,
      n: 1,
    });
    expect(error.mock.calls.join("\n")).toContain("gone");
  } finally {
    error.mockRestore();
  }
});

test("a one-case result prints its comparison and no NaN", () => {
  const run = (passed) => ({
    costUsd: 1,
    graders: [{ name: "works", passed }],
  });
  const result = {
    cases: [
      {
        name: "solo",
        dir: "evals/no-such-case",
        arms: {
          with: [run(true), run(true), run(false)],
          without: [run(false), run(false), run(false)],
        },
      },
    ],
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eval-report-"));
  const file = path.join(tmp, "result.json");
  fs.writeFileSync(file, JSON.stringify(result));
  const r = spawnSync(
    "bun",
    [path.join(import.meta.dirname, "../../evals/report.mjs"), file],
    { encoding: "utf8" },
  );
  fs.rmSync(tmp, { recursive: true, force: true });
  expect(r.status).toBe(0);
  expect(r.stdout).not.toContain("NaN");
  expect(r.stdout).toContain("with plugin vs without: +67%");
});

test("the case table names the graders that failed, with counts", () => {
  const run = (format, works) => ({
    costUsd: 1,
    graders: [
      { name: "format", passed: format, scored: true },
      { name: "works", passed: works, scored: true },
    ],
  });
  const result = {
    cases: [
      {
        name: "split",
        dir: "evals/no-such-case",
        arms: { with: [run(false, true), run(false, false), run(true, true)] },
      },
    ],
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eval-report-"));
  const file = path.join(tmp, "result.json");
  fs.writeFileSync(file, JSON.stringify(result));
  const r = spawnSync(
    "bun",
    [path.join(import.meta.dirname, "../../evals/report.mjs"), file],
    { encoding: "utf8" },
  );
  fs.rmSync(tmp, { recursive: true, force: true });
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/split\s+1\/3 .*failed: format 2, works 1/);
});
