# Development

## Commands

Run these in the repository root:

```bash
just test                    # bun test ./tests/
just lint                    # biome ci (lint and format)
just validate                # claude plugin validate --strict
just check                   # all three
just bump minor --dry-run    # preview a version bump
claude --plugin-dir plugins/dotclaude plugin details dotclaude  # inventory and token cost
just usage --days 7          # where your usage went
just sandbox                 # Claude Code with this checkout, own config
just sandbox-clean           # remove the sandbox
just wiki                    # publish wiki/ to the GitHub wiki
```

`just check` must pass before you call a change done.
CI runs `biome ci` and the tests on Linux and macOS.

*Why `biome ci` locally:* CI checks formatting, but `biome lint` does not.
A local run passed while CI failed on format.

## Why Bun

Hooks run on every tool call, so their start time adds to every step of a session.
Bun starts faster than Node.
The plugin uses Bun ESM with no dependencies at run time.

## Layout rules

- *One owner for each number.*
  `plugins/dotclaude/lib/budget.mjs` holds every usage bound.
  Tests fail when the output style, the settings profile, or the option text disagrees with it.
- *No copy of Claude Code.*
  Runtime JavaScript (`plugins/`) does only the work that the latest Claude Code does not do.
  When Claude Code has a setting, a hook, or another extension point for a need, use it.
- *Layered imports.*
  `plugins/dotclaude/lib/` imports only itself.
  `hooks/`, `status-line/`, and the skill scripts import only `lib/` and their own folder.
- *Guards get strings.*
  The tests give commands to the guards as strings, and never run a guarded command.

*Why:* a number with two owners drifts, and the drift shows up as two bounds that disagree.
Layered imports keep the start of each hook small and its failure local.
A test that runs a destructive command can do the damage that the guard exists to stop.

See the design principles on the [Design](Design) page.

## Sandbox

`just sandbox` runs Claude Code with the checkout as its plugin in a separate config directory.
A test then does not change your own setup.
[Sandbox](Sandbox) tells how to test in it, for people and for AI agents.
To try a checkout in your own config, run `claude --plugin-dir /path/to/dotclaude/plugins/dotclaude`.

## Types

The root `tsconfig.json` gives an editor the types of the Claude Code hooks module.
It extends `plugins/dotclaude/.claude-plugin/types/tsconfig.json`.
Claude Code writes that folder when it loads the plugin from your checkout, for example in `just sandbox`.
Git ignores the folder, and the plugins have no `tsconfig.json`, because an installed plugin does not get the folder.

## Releases

`just bump` sets one version in `package.json` and in the `plugin.json` of each plugin under `plugins/`.
It also moves the `[Unreleased]` CHANGELOG entries under a dated heading.
Before 1.0, a release can change or remove behavior without a compatibility layer.

## Evals

The behavior evals run with `claude plugin eval`.
`plugins/dotclaude/evals/` has 13 tasks in 5 tiers, from a one-file fix to debugging, review, investigation, and web research.
Each run costs money, so run it only when you decide to.

```bash
claude plugin eval plugins/dotclaude --model haiku --judge-model sonnet --runs 3 --scaffold \
  --allow-tools Bash Write Edit --keep-temp --json plugins/dotclaude/evals/results/run.json
bun plugins/dotclaude/evals/oracle.mjs plugins/dotclaude/evals/results/run.json   # hidden test oracles, tokens
bun plugins/dotclaude/evals/report.mjs plugins/dotclaude/evals/results/run.json   # pass rate, pass^k, cost per pass
```

1. Write and change cases on Haiku 4.5 (`--model haiku`), because it is the cheapest model.
   Use `--tag tier-1` or `--case <name>` to run a part.
1. Gate a release on Opus 5.5 (`--model opus`) with 3 or more runs.
1. To compare with an earlier release, put the release in a worktree, copy the cases into it, and run the same command there.
   Then give both results to `bun plugins/dotclaude/evals/report.mjs <new.json> --before <old.json>`.

*Why the flags:*

- `--scaffold` runs the `fixture.sh` of each case, which builds the workspace.
- `--allow-tools` grants the tools that the cases list.
- `plugins/dotclaude/evals/oracle.mjs` needs `--keep-temp`, because it runs each hidden `oracle.sh` in a copy of the kept workspace.
- `claude plugin eval` has no grader that runs a command.
- `--judge-model sonnet` sets the model of the `llm` graders.

When the plugin wrote to the `home/` or `tmp/` of a run, the CLI seals them in `sealed/` with mode 000.
It warns you once for each run.
`plugins/dotclaude/evals/oracle.mjs` opens the seal only for the copy, and it runs `git` only in the copy.

The default judge is Haiku 4.5.
It failed a right reply of the removed `t4-slices` case in 3 of 3 runs.
The CLI does not keep the text of the judge, so the cause is not known.
Do not use the model of the agent as the judge, because a model prefers its own output.
The default ablation also runs each case without the plugin, so the report shows the effect of the plugin.

`t4-handoff` calls a skill that 0.17.0 renamed.
Releases before 0.17.0 fail its `with-only` grader.

*Why tiers:* the tiered cases show what dotclaude changes on tasks of growing size.
A command grades each case, not the words of the reply.
The results and their limits are on the [Evals](Evals) page.

## Wiki

The wiki source is the `wiki/` folder in the repository.
A change to a wiki page goes through a pull request, like a code change.
`just wiki` publishes `wiki/` to the GitHub wiki.
