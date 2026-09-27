// codex-worker may only write its brief, run the runner, and read the report.

import { expect, test } from "bun:test";
import { hook } from "../support/hooks.mjs";

const RUNNER = "/p/skills/codex-fanout/scripts/run-codex.mjs";

function decision(command, agentType = "dotclaude:codex-worker") {
  const out = hook("pre-tool-use/confine-codex-worker.mjs", {
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
    agent_type: agentType,
  });
  return out?.hookSpecificOutput?.permissionDecision ?? "pass";
}

test("codex-worker runs only its procedure", () => {
  for (const command of [
    `bun "${RUNNER}" --brief /s/codex-brief-x.md --dir /r`,
    `bun "${RUNNER}" --brief /s/codex-brief-x.md --dir /r --model gpt-6-sol`,
    "cat > /s/codex-brief-calc.md <<'EOF'\nTask: read calc.py and run the tests.\nEOF",
    'S=/s; cat > "$S/codex-brief-x.md" <<EOF\nFix it.\nEOF',
    "cat /s/codex-brief-x.report.md",
  ])
    expect(decision(command), command).toBe("pass");
  for (const command of [
    "cat calc.py",
    "cat > calc.py <<'EOF'\ndef add(a, b):\n    return a + b\nEOF",
    `python3 -c "import calc; assert calc.add(2, 3) == 5"`,
    "sleep 180",
    `bun "${RUNNER}" --brief /s/b.md; cat calc.py`,
    `bun "${RUNNER}" --brief /s/b.md > calc.py`,
    "command codex exec -p dotclaude-luna -",
    "git status --short",
  ])
    expect(decision(command), command).toBe("deny");
});

test("other agents are not confined", () => {
  expect(decision("cat calc.py", "dotclaude:implementer")).toBe("pass");
  expect(decision("cat calc.py", null)).toBe("pass");
});
