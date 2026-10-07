// The hooks module of dotclaude-jev.
// It acts on the session note in `hooks/session-start/second-opinion.md`:
// Jev picks before the user answers a question with options.
// On each `AskUserQuestion`, the hook runs `jev.mjs ask` once. Jev sorts each
// question into preference or facts, and picks from its options. A facts
// question shows the pick of Jev and its confidence to the user. A question
// about a goal, a preference, or an approval stays as it is. The hook never
// denies, so Claude has no reason to ask in plain text instead. Without
// `TYPESAFE_API_KEY`, or when Jev fails, the question passes unchanged.

/** Under this confidence, the TypeSafe docs treat an answer as uncertain. */
const MIN_CONFIDENCE = 0.5;
const JEV_TIMEOUT_MS = 45000;

const KIND = {
  type: "choice",
  instructions:
    "Only the user can answer some questions. Facts decide others. Which is this question?",
  criteria: {
    preference:
      "A goal, a preference, an approval, or a choice that reasonable engineers make either way",
    facts:
      "Correctness, security, data loss, performance, or maintenance cost decide the answer",
  },
};

/** The Jev request for the questions that have 2 or more options. */
export function jevRequest(questions) {
  const asked = {};
  const state = [];
  questions.forEach((q, i) => {
    const options = Array.isArray(q?.options) ? q.options : [];
    if (options.length < 2) return;
    state.push(
      `Question ${i}: ${q.question}`,
      ...options.map((o) => `- ${o.label}: ${o.description ?? ""}`),
    );
    asked[`kind_${i}`] = {
      ...KIND,
      instructions: `${KIND.instructions} (question ${i})`,
    };
    asked[`pick_${i}`] = {
      type: "choice",
      instructions: `Which option is the best answer to question ${i}?`,
      criteria: Object.fromEntries(
        options.map((o) => [o.label, o.description || o.label]),
      ),
    };
  });
  return Object.keys(asked).length
    ? { state: state.join("\n"), questions: asked }
    : null;
}

/** The questions with the pick of Jev added to each facts question. */
export function withPicks(questions, answers) {
  return questions.map((q, i) => {
    const kind = answers?.[`kind_${i}`];
    const pick = answers?.[`pick_${i}`];
    if (
      kind?.choice !== "facts" ||
      !(kind.confidence >= MIN_CONFIDENCE) ||
      !(pick?.confidence >= MIN_CONFIDENCE) ||
      !q.options.some((o) => o.label === pick.choice)
    )
      return q;
    const note = `Jev picks "${pick.choice}" (confidence ${pick.confidence.toFixed(2)}).`;
    return { ...q, question: `${q.question}\n\n${note}` };
  });
}

export function register(on) {
  on("tool.call", async ($, e, next) => {
    if (e.tool !== "AskUserQuestion" || !Array.isArray(e.questions))
      return next(e);
    try {
      if (!(await $.env.get("TYPESAFE_API_KEY"))) return next(e);
      const request = jevRequest(e.questions);
      if (!request) return next(e);
      const run = await $.process.run(
        [
          "node",
          `${$.plugin.root}/skills/second-opinion/scripts/jev.mjs`,
          "ask",
          "--state",
          request.state,
        ],
        {
          stdin: JSON.stringify({ questions: request.questions }),
          timeoutMs: JEV_TIMEOUT_MS,
        },
      );
      if (run.exitCode !== 0) return next(e);
      const questions = withPicks(e.questions, JSON.parse(run.stdout));
      return next({ ...e, questions });
    } catch {
      // Jev is missing, slow, or gave output that is not valid.
      return next(e);
    }
  });
}
