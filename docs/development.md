# Development

Part of the [dotclaude documentation](README.md).

## Commands

```bash
just test                    # bun test ./tests/
just lint                    # biome ci (lint and format)
just validate                # claude plugin validate --strict
just check                   # all three
just bump minor --dry-run    # preview a version bump
claude --plugin-dir . plugin details dotclaude  # inventory and token cost
just usage --days 7          # where your usage went
just sandbox                 # Claude Code with this checkout, own config
just sandbox-clean           # remove the sandbox
```

`just check` must pass before a change is done. CI runs `biome ci` and the
tests on Linux and macOS.

**Why `biome ci` locally:** CI checks formatting. `biome lint` does not, so a
local run passed while CI failed on format.

## Why Bun

Hooks run on every tool call, so their start time adds to every step of a
session. Bun starts faster than Node. The plugin uses Bun ESM with no
dependencies at run time.

## Layout Rules

- **One owner for each number.** `hooks/lib/_budget.mjs` holds every usage
  bound. Tests fail when the output style, the settings profile, or the option
  text disagrees with it.
- **Layered imports.** Event hooks import only `hooks/lib`. `hooks/lib`
  imports only itself. Skill scripts may import `hooks/lib`.
- **Guards get strings.** The tests give commands to the guards as strings,
  and never run a guarded command.

**Why:** a number with two owners drifts, and the drift shows up as two
bounds that disagree. Layered imports keep each hook's start small and its
failure local. A test that runs a destructive command can do the damage that
the guard exists to stop.

See [design principles](dossier/design.md#1-design-principles).

## Sandbox

`just sandbox` runs Claude Code with the checkout as its plugin in a separate
config directory, so a test does not change your own setup.
[Sandbox](sandbox.md) tells how to test in it, for people and for AI agents.
To try a checkout in your own config, run
`claude --plugin-dir /path/to/dotclaude`.

## Releases

`just bump` sets one version in `.claude-plugin/plugin.json` and
`package.json`, and it moves the `[Unreleased]` CHANGELOG entries under a
dated heading. Before 1.0, a release can change or remove behavior without a
compatibility layer.

## Evals

The behavior evals run with `claude plugin eval`. `evals/` has 8 tasks in 4
tiers, from a one-file fix to delegation. `evals-heldout/` has cases written
without access to dotclaude's prompts. Each run costs money, so run it only
when you decide to.

```bash
claude plugin eval . --model haiku --judge-model sonnet --runs 3 --scaffold \
  --allow-tools Bash Write Edit --keep-temp --json evals/results/run.json
bun evals/oracle.mjs evals/results/run.json   # hidden test oracles, tokens
bun evals/report.mjs evals/results/run.json   # pass rate, pass^k, cost per pass
```

1. Write and change cases on Haiku 4.5 (`--model haiku`), because it is the
   cheapest model. Use `--tag tier-1` or `--case <name>` to run a part.
1. Gate a release on Opus 5.5 (`--model opus`) with 3 or more runs.
1. To compare with an earlier release, put the release in a worktree, copy
   the cases into it, and run the same command there. Then give both results
   to `bun evals/report.mjs <new.json> --before <old.json>`.

**Why the flags:** `--scaffold` runs each case's `fixture.sh`, which builds
the workspace. `--allow-tools` grants the tools that the cases list.
`evals/oracle.mjs` needs `--keep-temp`, because it runs each hidden
`oracle.sh` in a copy of the kept workspace. When the plugin wrote to the
run's `home/` or `tmp/`, the CLI seals them in `sealed/` with mode 000, and
it warns you once for each run. `evals/oracle.mjs` opens the seal only for
the copy, and it runs `git` only in the copy. `claude plugin eval` has no
grader that runs a command. `--judge-model sonnet` sets the model of the `llm`
graders. The default judge is Haiku 4.5, and it failed a correct `t4-slices`
reply 3 times out of 3. The CLI does not keep the judge's text, so the cause
is not known. Do not use the agent's model as the judge, because a model
prefers its own output. The default ablation also runs each case without
the plugin, so the report shows the plugin's effect.

`t4-slices` and `t4-handoff` call skills that 0.17.0 renamed. Releases before
0.17.0 fail their `with-only` graders.

**Why two suites:** the tiered cases show what dotclaude changes on tasks of
growing size. Held-out cases check that dotclaude does not make Claude worse
on work that the rules did not foresee. The results and their limits are in
[evals](dossier/evals.md).
