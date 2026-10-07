# Development

This page is for contributors.
It shows the commands, the layout rules, and the steps to test, release, and publish a change.

## Before you begin

- Install [Bun](https://bun.sh) and `just`.
- Install Claude Code 2.1.292 or later.
  `just validate`, `just lab`, `just update`, and `just release` call the `claude` CLI.
- Run each command in the repository root.

## Commands

| Command | What it does |
| --- | --- |
| `just test` | Runs `bun test ./tests/`. Extra arguments go to `bun test`, such as a file or a `-t` filter. |
| `just lint` | Runs `bun run lint`. |
| `just validate` | Runs `bun run validate`, which checks the manifests, skills, and agents. |
| `just lab` | Runs `claude plugin test plugins/dotclaude`, the hook lab. |
| `just check` | Runs lint, test, validate, and lab. It must pass before you call a change done. |
| `just sandbox` | Runs Claude Code with this checkout as its plugin, in its own config. See [Sandbox](Sandbox). |
| `just sandbox-clean` | Removes the sandbox. |
| `just usage` | Shows where your Claude Code usage went. Add `--days N` or `--json`. |
| `just update` | Updates the marketplace, then each plugin under `plugins/` that you installed. Restart Claude Code after it. |
| `just bump <level>` | Bumps the version. See [Releases](#releases). |
| `just release` | Tags each plugin and pushes the tags. See [Releases](#releases). |
| `just wiki` | Publishes `wiki/` to the GitHub wiki. |

```bash
just check                                   # must pass before you call a change done
just test tests/dotclaude/bash-guard.test.mjs   # one file
just usage --days 7                          # where your usage went
bunx markdownlint-cli2 README.md             # lint Markdown
```

Headings and code blocks in Markdown have a 100-column bound.
Each `.md` file has at most 300 lines.

## The tests layout

| Folder | What it holds |
| --- | --- |
| `tests/` | The repository tests, with one folder for each plugin. `just test` runs them with `bun test`. |
| `plugins/dotclaude/tests/mod.test.ts` | The hook lab tests. `just lab` runs them. |
| `tools/` | The repository scripts, such as `sandbox.mjs`, `bump-version.mjs`, and `usage-report.mjs`. |

### The hook lab

`just lab` runs `claude plugin test plugins/dotclaude`.
The test file imports from `claude-code/testing`, loads `hooks/mod.mjs`, and fires `tool.check` and `prompt.section` events.
It stubs the engine verdict, the environment, `session.cwd`, `session.root`, `session.id`, and `process.run`.
No command runs, no session starts, and no network call goes out.

The file has 5 tests:

- A recursive `rm` outside the project asks.
- A recursive `rm` in the project or in a temp folder keeps the verdict.
- A deny of the engine stays a deny.
- The first call to a repository of another owner with a policy asks once.
- A repository of the user, or one with no policy, keeps the verdict.

## Layout rules

| Rule | Meaning |
| --- | --- |
| One owner for each number | `plugins/dotclaude/lib/budget.mjs` holds every usage bound. Tests pin its copies in code and config, not in prose. |
| No copy of Claude Code | Runtime JavaScript (`plugins/`) does only the work that the latest Claude Code does not do. When Claude Code has a setting, a hook, or another extension point for a need, use it. |
| Layered imports | `plugins/dotclaude/lib/` imports only itself. `hooks/`, `status-line/`, and the skill scripts import only `lib/` and their own folder. |
| Guards get strings | The tests give commands to the guards as strings, and never run a guarded command. |
| No patch of Claude Code | Never patch the CLI binary or its npm package. Reading the bundle for evidence is allowed. |

*Why:* a number with two owners drifts, and the drift shows up as two bounds that disagree.
Layered imports keep the start of each hook small and its failure local.
A test that runs a destructive command can do the damage that the guard exists to stop.
See the design principles on the [Design](Design) page.

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

- `just bump` sets one version in the manifests, and it moves the `[Unreleased]` CHANGELOG entries under a dated heading.
- `just release` runs `claude plugin tag` on each plugin under `plugins/` at `HEAD`.
- It checks all plugins before it makes a tag, so a bad manifest stops the release with no tag made.
- It then pushes all tags to `origin` in one atomic push.
- Before 1.0, a release can change or remove behavior without a compatibility layer.

## Wiki

1. Change a page in `wiki/`.
   A change goes through a pull request, like a code change.
1. Publish the folder to the GitHub wiki.

   ```bash
   just wiki
   ```

> **Note:** The wiki repository exists only after the first page is made in the GitHub web UI.

## Evals

0.27.0 removed the behavior evals and `just eval-agent`.
The old results are on the [Eval history](Evals-History) page.

## Next steps

- [Sandbox](Sandbox) tells how to test in a separate config.
- [Design](Design) gives the design principles.
