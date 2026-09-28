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

The behavior evals run with `claude plugin eval`. `evals/` tests dotclaude's
own rules. `evals-heldout/` has cases written without access to dotclaude's
prompts. `bun evals/report.mjs <result.json>` reports the results with 95%
intervals.

**Why two suites:** cases written with the rules show that Claude follows
them. Held-out cases check that dotclaude does not make Claude worse on work
that the rules did not foresee. The results and their limits are in
[evals](dossier/evals.md).
