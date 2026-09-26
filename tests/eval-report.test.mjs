// Statistics in evals/report.mjs.

import assert from "node:assert/strict";
import { test } from "node:test";
import { meanSe, trialPassed, wilson } from "../evals/report.mjs";

const near = (a, b) => assert.ok(Math.abs(a - b) < 0.005, `${a} vs ${b}`);

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
  assert.ok(Number.isNaN(meanSe([1]).se));
});

test("a trial passes only when every scored grader passed", () => {
  const run = (graders) => ({ graders });
  assert.ok(trialPassed(run([{ name: "a", passed: true, scored: true }])));
  assert.ok(
    !trialPassed(
      run([
        { name: "a", passed: true, scored: true },
        { name: "b", passed: false, scored: true },
      ]),
    ),
  );
  assert.ok(
    trialPassed(
      run([
        { name: "a", passed: true, scored: true },
        { name: "b", passed: false, scored: false },
      ]),
    ),
  );
  assert.ok(
    trialPassed(
      run([
        { name: "a", passed: true, scored: true },
        { name: "b", passed: false, scored: true },
      ]),
      new Set(["b"]),
    ),
  );
});
