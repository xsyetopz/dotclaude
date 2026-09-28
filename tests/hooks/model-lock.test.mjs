// Model lock: subagent models, model switches, and fast mode.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { data, hook } from "../support/hooks.mjs";

test("model lock denies disallowed subagent models and switches", () => {
  const agent = (model, env = {}) =>
    hook(
      "pre-tool-use/restrict-subagent-models.mjs",
      {
        hook_event_name: "PreToolUse",
        tool_name: "Agent",
        tool_input: { model, prompt: "x" },
      },
      env,
    );
  for (const model of ["sonnet", "claude-sonnet-5"])
    expect(agent(model, { ANTHROPIC_DEFAULT_SONNET_MODEL: "" })).toBe(null);
  // Fable is never a subagent model, even where the plan includes it.
  for (const model of ["fable", "claude-fable-5-1"]) {
    const out = agent(model, { ANTHROPIC_DEFAULT_FABLE_MODEL: "" });
    expect(out.hookSpecificOutput.permissionDecision, model).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/2\.5x/);
  }
  const old = agent("claude-opus-4-1");
  expect(old.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(old.hookSpecificOutput.permissionDecisionReason).toMatch(
    /mechanical-worker/,
  );
  for (const model of ["haiku", "claude-haiku-4-5"])
    expect(
      hook(
        "pre-tool-use/restrict-subagent-models.mjs",
        {
          hook_event_name: "PreToolUse",
          tool_name: "Agent",
          tool_input: { model, prompt: "x" },
        },
        { ANTHROPIC_DEFAULT_HAIKU_MODEL: "" },
      ),
      model,
    ).toBe(null);
  expect(
    hook("pre-tool-use/restrict-subagent-models.mjs", {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { prompt: "x" },
    }),
  ).toBe(null);
  expect(
    hook("pre-tool-use/restrict-subagent-models.mjs", {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { model: "opus" },
    }),
  ).toBe(null);
  expect(
    hook("pre-model-switch/restrict-models.mjs", {
      hook_event_name: "PreModelSwitch",
      to_model: "claude-sonnet-5",
    }),
  ).toBe(null);
  expect(
    hook("pre-model-switch/restrict-models.mjs", {
      hook_event_name: "PreModelSwitch",
      to_model: "claude-opus-4-1",
    }).decision,
  ).toBe("block");
  expect(
    hook("pre-model-switch/restrict-models.mjs", {
      hook_event_name: "PreModelSwitch",
      to_model: "claude-fable-5-1",
    }),
  ).toBe(null);
});

test("model lock blocks a settings change that enables fast mode", () => {
  const settings = path.join(data, "settings.json");
  fs.writeFileSync(settings, JSON.stringify({ fastMode: true }));
  expect(
    hook("config-change/block-fast-mode.mjs", {
      hook_event_name: "ConfigChange",
      source: "user_settings",
      file_path: settings,
    }).decision,
  ).toBe("block");
  fs.writeFileSync(settings, JSON.stringify({ fastMode: false }));
  expect(
    hook("config-change/block-fast-mode.mjs", {
      hook_event_name: "ConfigChange",
      source: "user_settings",
      file_path: settings,
    }),
  ).toBe(null);
  fs.writeFileSync(settings, JSON.stringify({ fastMode: true }));
  expect(
    hook(
      "config-change/block-fast-mode.mjs",
      {
        hook_event_name: "ConfigChange",
        source: "user_settings",
        file_path: settings,
      },
      { CLAUDE_PLUGIN_OPTION_MODEL_LOCK: "false" },
    ),
  ).toBe(null);
});

test("general-purpose is refused, and other subagents run in the foreground", () => {
  const spawn = (input, env = {}) =>
    hook(
      "pre-tool-use/prefer-dotclaude-agents.mjs",
      { hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: input },
      env,
    )?.hookSpecificOutput;
  const forksOff = { CLAUDE_CODE_FORK_SUBAGENT: "false" };
  const refused = spawn({ subagent_type: "general-purpose", prompt: "x" });
  expect(refused.permissionDecision).toBe("deny");
  // A plan has a route too, so it does not go to an implementer.
  expect(refused.permissionDecisionReason).toMatch(
    /Draft a plan yourself.*`dotclaude:plan-reviewer`/,
  );
  expect(spawn({ prompt: "x" }, forksOff).permissionDecision).toBe("deny");
  const rewritten = spawn({
    subagent_type: "dotclaude:implementer",
    prompt: "x",
    run_in_background: true,
  });
  expect(rewritten.permissionDecision).toBe("allow");
  expect(rewritten.updatedInput).toEqual({
    subagent_type: "dotclaude:implementer",
    prompt: "x",
    run_in_background: false,
  });
  // With forks on, a missing type spawns a fork, which also runs in the foreground.
  const forksOn = { CLAUDE_CODE_FORK_SUBAGENT: "" };
  expect(
    spawn({ prompt: "fork this" }, forksOn).updatedInput.run_in_background,
  ).toBe(false);
  expect(
    spawn({ subagent_type: "Explore", run_in_background: false }),
  ).toBeUndefined();
  expect(
    spawn(
      { subagent_type: "general-purpose" },
      { CLAUDE_PLUGIN_OPTION_SUBAGENT_GUIDANCE: "false" },
    ),
  ).toBeUndefined();
});
