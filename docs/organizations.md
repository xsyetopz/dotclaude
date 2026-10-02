# Organizations

This page tells an admin how to roll out dotclaude to a team or a company. It
also gives the limits that apply to large installs.

## Managed Settings

**What:** `install-managed.mjs --org` writes the managed drop-in
`managed-settings.d/50-dotclaude.json`. Run it from the `setup` skill
directory with admin rights:

```sh
bun skills/setup/scripts/install-managed.mjs --org            # dry run
sudo "$(command -v bun)" skills/setup/scripts/install-managed.mjs --org --apply
```

The drop-in has the personal lock from
[Settings Profile](settings-profile.md#managed-lock) and these keys:

| Key | Value | Why |
| --- | --- | --- |
| `enabledPlugins` | `{"dotclaude@dotclaude": true}` | Enables dotclaude for every user. Policy settings take precedence over user and project settings. |
| `extraKnownMarketplaces` | the `xsyetopz/dotclaude` GitHub source | Registers the marketplace for every user. It also keeps the skill `allowed-tools` (see below). |
| `enforceAvailableModels` | `true` | The "Default" model also obeys `availableModels`. |
| `requiredMinimumVersion` | `CLAUDE_CODE` in `hooks/lib/_version.mjs` | Claude Code exits at startup when it is older than the version that dotclaude needs. |

**Why the drop-in sets no `strictKnownMarketplaces`:** that list is an
allowlist. A list that names only dotclaude blocks every other marketplace of
your organization. Write your own list in `managed-settings.json` and include
the dotclaude source:

```json
{
  "strictKnownMarketplaces": [
    { "source": "github", "repo": "xsyetopz/dotclaude" },
    { "source": "github", "repo": "your-org/*" }
  ]
}
```

A `strictKnownMarketplaces` entry blocks other sources. It does not register a
marketplace, so keep `extraKnownMarketplaces` as well (**binary**).

**Why the drop-in sets no `permissions`:** deny rules depend on your
repositories and your security policy. dotclaude cannot select them for you.
Put them in your own `managed-settings.json`. dotclaude's hooks ask before
destructive commands in each session. A managed `deny` rule blocks a command
also when a user turns off a guard option.

**Why dotclaude writes no managed hooks:** Claude Code 2.1.286 ignores `hooks`
in managed settings (upstream issue #98376). The hooks come from the plugin,
which `enabledPlugins` turns on.

The drop-in never changes an existing `managed-settings.json`. Claude Code
merges `managed-settings.json` first, and then each `*.json` file in
`managed-settings.d/` in alphabetical order.

## Skill Permissions Under A Managed-Only Policy

When managed settings set `allowManagedPermissionRulesOnly: true`, Claude Code
ignores the `allowed-tools` frontmatter of a plugin skill, unless managed
settings vouch for the plugin's marketplace (**binary**). Managed settings
vouch for a marketplace when one of these is true:

- `extraKnownMarketplaces` declares its registered source.
- A `strictKnownMarketplaces` entry names it exactly or with `owner/*`.

The `--org` drop-in declares the dotclaude source. Without it, the `setup`
skill asks for each script that it runs.

## Plugin Options For Every User

Plugin options are in each user's settings. Set them with a script that runs
for each user, for example from your device management tool:

```sh
echo '{"model_plan": "enterprise"}' |
  claude plugin configure dotclaude@dotclaude --values-stdin
```

The command reads a JSON object of single-line strings. Options that the object
does not name keep their values. Set `model_plan` when plan detection cannot
read the plan, for example with API keys or a gateway.

## Budgets

Team and Enterprise seats use a budget that an admin controls. Users reported
that an Enterprise budget ran out in 1 to 1.5 weeks (**reported**). For these
seats, the session note tells Claude to keep the main conversation at medium
effort and to give bounded work to the Sonnet 5.5 agents (`implementer` and
`mechanical-worker`).

Headless runs (`claude -p`) cost about 3 times as much as the same work in an
interactive session (**reported**, 6 reports). Measure your own runs before
you move work to CI.

## Windows

- **Paths with spaces:** each hook in `hooks/hooks.json` uses the exec form
  (`"command": "bun"` with `args`). No shell splits `${CLAUDE_PLUGIN_ROOT}`,
  so a plugin path with spaces works. Claude Code's own hook check recommends
  this form (**binary**). A run on Windows is not verified.
- **`bun` on `PATH`:** the hooks start `bun`. Install Bun for each user.
- **Known limit, Windows desktop app (MSIX):** plugin hooks cannot find their
  scripts, because the plugin path exists only inside the package's
  virtualized file system. Every hook fails with `ENOENT` (upstream issue
  #96087, open). Use the Claude Code CLI on Windows until the issue is fixed.
