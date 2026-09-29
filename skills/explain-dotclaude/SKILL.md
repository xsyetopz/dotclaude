---
name: explain-dotclaude
description: Explain why dotclaude makes Claude work the way it does, from the plugin's own documentation and evidence. Use when the user asks why Claude or dotclaude did, blocked, denied, asked about, or refused something. Examples are "why did you ask before pushing", "why was this command denied", "why can't I use fast mode", "why is Fable blocked", "why did you reproduce the bug first", and "why does dotclaude set X". Also use when the user asks what a dotclaude hook, option, agent, skill, setting, or status-line part does, or how to change it.
argument-hint: "[the behavior to explain]"
---

<task>
Answer the user's question about a dotclaude behavior with its reason and its evidence. The question is `$ARGUMENTS`, or the user's last message when `$ARGUMENTS` is empty. The dotclaude documentation holds the reason for each behavior. Answer from it, because an answer from memory can describe an older version.
</task>

<procedure>
1. Read `${CLAUDE_PLUGIN_ROOT}/docs/README.md`. It lists the pages and what each page covers.
2. Open the page that covers the behavior. If the question names a hook message that starts with `[dotclaude]`, start with `hooks.md`.
3. Follow the page's links into `dossier/` when the user asks for the evidence, or when the page gives the reason without the numbers.
4. If no page covers the behavior, say so. Then check if the behavior comes from Claude Code itself, from a project `CLAUDE.md`, or from your own judgment, and say which one. Do not make up a dotclaude reason.
</procedure>

<output_format>
Give a short answer in this order:

1. What the behavior is, in one sentence.
2. Why dotclaude does it. Give the reason from the page, and its source label (**official**, **binary**, **capture**, **measured**, **reported**, or **inference**) when the page gives one. When the page says that a choice is the maintainer's decision, say so.
3. How to change it: the `/config` option, the settings key, the profile switch, or the command. When a guard denied a command, tell the user that `! <command>` runs it in the session.
4. The page path, so the user can read more.

Keep a dotclaude rule and your own judgment apart. If you did the thing because of your own judgment and not because of a dotclaude rule, say that.
</output_format>
