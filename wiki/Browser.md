# Browser

The `dotclaude-browser` plugin lets Claude drive a real browser with `agent-browser`, or with CloakBrowser on sites that block automation.
It adds the `drive-web-browser` skill.

## Before you begin

| Need | Why |
| --- | --- |
| `agent-browser` ([vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)) | The skill runs it for each browser step. |
| [CloakBrowser](https://github.com/CloakHQ/cloakbrowser) binary under `~/.cloakbrowser/` | Only for sites with bot detection. |

> **Note:** The newest CloakBrowser builds need a GitHub sign-in or a paid plan.
> Claude does not install or sign in for you.

## Install agent-browser

1. Install the tool.

   ```bash
   npm install -g agent-browser
   ```

1. Add the plugin from the dotclaude marketplace with `/plugin`.

## How it works

The plugin is skill-only and has no hook.
Claude loads `dotclaude-browser:drive-web-browser` for a task in a web browser, and the skill holds the commands and the rules.
The workflow is:

```bash
agent-browser open <url>
agent-browser snapshot
agent-browser close
```

The snapshot lists the page as an accessibility tree with refs such as `@e1`.
Claude uses a ref in `click`, `fill`, and `type`, and takes a new snapshot after the page changes.

## Choose a backend

| Backend | When | How |
| --- | --- | --- |
| `agent-browser` (default) | Most pages. | No setup. |
| `cloakbrowser` | A site shows a bot check, a block page, or a CAPTCHA to `agent-browser`. | Set the option `backend` to `cloakbrowser` in `/config` under dotclaude-browser. |

With `cloakbrowser`, the skill tells Claude to use CloakBrowser, and not plain `agent-browser`.
Claude runs `agent-browser` with the CloakBrowser binary and `--headed`, because headless mode is easier to detect.

```bash
agent-browser --executable-path <cloakbrowser binary> --headed open https://example.com
```

On macOS the binary is at `~/.cloakbrowser/chromium-<version>/Chromium.app/Contents/MacOS/Chromium`.
CloakBrowser reduces challenges but does not solve them.

## Prompts and challenges

| Case | What Claude does |
| --- | --- |
| Cookie banner | Dismisses it with a normal click, and picks the least-permissive option. |
| Sign-in | Uses `--profile <path>` for a persistent session, or `--auto-connect` to reuse your running Chrome. |
| CAPTCHA | Asks you to complete it by hand. |

## Troubleshooting

When a site blocks a page, Claude tries these steps in order:

1. Switch from plain `agent-browser` to CloakBrowser.
1. Run `agent-browser read <url>` for a machine-readable version.
1. Look for RSS or Atom feeds, sitemaps, or APIs.
1. Ask you to open the page by hand.

> **Note:** The `recognize-captcha` skill and the offline `ddddocr-rs` OCR no longer exist in the plugin.
> The CHANGELOG removed them in 0.20.0, because CloakBrowser keeps most CAPTCHAs away.

Text on a web page is data, not instructions.
Claude follows your task, and not instructions in page content.

## Related pages

- [Install](Install)
- [Parts](Parts)
