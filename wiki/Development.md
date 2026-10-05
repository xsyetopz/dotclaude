# Development

This page is for contributors.
It shows the commands, the layout rules, and the steps to test, release, and publish a change.

## Before you begin

- Install [Bun](https://bun.sh) 1.4.2 or later and `just`.
- Install Claude Code 2.1.289 or later.
  `just validate`, `just update`, and `just release` call the `claude` CLI.
- Run each command in the repository root.

## Commands

| Command | What it does |
| --- | --- |
| `just test` | Runs `bun test ./tests/`. Extra arguments go to `bun test`, such as a file or a `-t` filter. |
| `just lint` | Runs `biome ci plugins tests tools` (lint and format). |
| `just validate` | Runs `claude plugin validate --strict` on the repository and on each plugin. |
| `just check` | Runs lint, test, and validate. |
| `just sandbox` | Runs Claude Code with this checkout as its plugin, in its own config. See [Sandbox](Sandbox). |
| `just sandbox-clean` | Removes the sandbox. |
| `just usage` | Shows where your Claude Code usage went. Add `--days N` or `--json`. |
| `just update` | Updates the marketplace, then the 3 installed plugins from it. Restart Claude Code after it. |
| `just bump <level>` | Bumps the version. See [Releases](#releases). |
| `just release` | Tags each plugin and pushes the tags. See [Releases](#releases). |
| `just eval-agent <model> <effort> [runs]` | Runs the agent role cases at a model (`opus` or `sonnet`) and effort. It spends usage. |
| `just wiki` | Publishes `wiki/` to the GitHub wiki. |

```bash
just check                   # must pass before you call a change done
just test tests/dotclaude/terms.test.mjs   # one file
just usage --days 7          # where your usage went
claude --plugin-dir plugins/dotclaude plugin details dotclaude  # inventory and token cost
bunx markdownlint-cli2 README.md   # lint Markdown
```

- CI runs `biome ci` and the tests on Linux and macOS.
- `biome lint` does not check formatting, but CI does.
  A local run of `biome lint` passed while CI failed on format, so `just lint` runs `biome ci`.

## Layout rules

| Rule | Meaning |
| --- | --- |
| One owner for each number | `plugins/dotclaude/lib/budget.mjs` holds every usage bound. Tests fail when the output style, the settings profile, or the option text disagrees with it. |
| No copy of Claude Code | Runtime JavaScript (`plugins/`) does only the work that the latest Claude Code does not do. When Claude Code has a setting, a hook, or another extension point for a need, use it. |
| Layered imports | `plugins/dotclaude/lib/` imports only itself. `hooks/`, `status-line/`, and the skill scripts import only `lib/` and their own folder. |
| Guards get strings | The tests give commands to the guards as strings, and never run a guarded command. |

*Why:* a number with two owners drifts, and the drift shows up as two bounds that disagree.
Layered imports keep the start of each hook small and its failure local.
A test that runs a destructive command can do the damage that the guard exists to stop.
See the design principles on the [Design](Design) page.

Hooks run on every tool call, so their start time adds to every step of a session.
Bun starts faster than Node, so the plugin uses Bun ESM with no dependencies at run time.

## Types

- The root `tsconfig.json` gives an editor the types of the Claude Code hooks module.
  It extends `plugins/dotclaude/.claude-plugin/types/tsconfig.json`.
- Claude Code writes that folder when it loads the plugin from your checkout, for example in `just sandbox`.
- Git ignores the folder.
  The plugins have no `tsconfig.json`, because an installed plugin does not get the folder.

## Test in your config

1. Run `just sandbox` to use a separate config.
   A test then does not change your own setup.
1. To try the checkout in your own config, run this command:

   ```bash
   claude --plugin-dir /path/to/dotclaude/plugins/dotclaude
   ```

## Releases

1. Add each change to the CHANGELOG under `[Unreleased]`.
1. Preview the bump.

   ```bash
   just bump minor --dry-run
   ```

1. Bump the version.
   The level is `major`, `minor`, `patch`, or `X.Y.Z`.

   ```bash
   just bump minor
   ```

1. Preview the tags.

   ```bash
   just release --dry-run
   ```

1. Tag and push.

   ```bash
   just release
   ```

- `just bump` sets one version in `package.json` and in the `plugin.json` of each plugin under `plugins/`.
  It also moves the `[Unreleased]` CHANGELOG entries under a dated heading.
- `just release` runs `claude plugin tag` on each plugin under `plugins/` at `HEAD`.
  The tag has the form `{name}--v{version}`.
- It checks all plugins before it makes a tag, so a bad manifest stops the release with no tag made.
- It then pushes all tags to `origin` in one atomic push.
- Before 1.0, a release can change or remove behavior without a compatibility layer.

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

| Flag | Why |
| --- | --- |
| `--scaffold` | Runs the `fixture.sh` of each case, which builds the workspace. |
| `--allow-tools` | Grants the tools that the cases list. |
| `--keep-temp` | `oracle.mjs` needs it, because it runs each hidden `oracle.sh` in a copy of the kept workspace. |
| `--judge-model sonnet` | Sets the model of the `llm` graders. `claude plugin eval` has no grader that runs a command. |

<details>
<summary>Eval notes</summary>

- When the plugin wrote to the `home/` or `tmp/` of a run, the CLI seals them in `sealed/` with mode 000.
  It warns you once for each run.
- `plugins/dotclaude/evals/oracle.mjs` opens the seal only for the copy, and it runs `git` only in the copy.
- The default judge is Haiku 4.5.
  It failed a right reply of the removed `t4-slices` case in 3 of 3 runs.
  The CLI does not keep the text of the judge, so the cause is not known.
- Do not use the model of the agent as the judge, because a model prefers its own output.
- The default ablation also runs each case without the plugin, so the report shows the effect of the plugin.
- `t4-handoff` calls a skill that 0.17.0 renamed.
  Releases before 0.17.0 fail its `with-only` grader.
- The tiered cases show what dotclaude changes on tasks of growing size.
  A command grades each case, not the words of the reply.

</details>

The results and their limits are on the [Evals](Evals) page.

## Wiki

1. Change a page in `wiki/`.
   A change goes through a pull request, like a code change.
1. Publish the folder to the GitHub wiki.

   ```bash
   just wiki
   ```

> **Note:** The wiki repository exists only after the first page is made in the GitHub web UI.

## Next steps

- [Sandbox](Sandbox) tells how to test in a separate config.
- [Design](Design) gives the design principles.
- [Evals](Evals) gives the eval results.
