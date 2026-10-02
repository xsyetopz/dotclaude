#!/usr/bin/env bun
// SessionStart(startup|resume): tell the user (not Claude) when instruction
// files pass the limits in _budget.mjs LIMITS. Warnings print in yellow,
// failures in red.
// - One file passes instructionLines: every CLAUDE.md, CLAUDE.local.md,
//   AGENTS.md, and `.claude/rules/` file in the repository, the global ones,
//   and every file they `@import`.
// - The text that loads at session start passes startupInstructionTokens: the
//   global CLAUDE.md and rules, the files in the working directory and every
//   directory above it, their imports, and project rules without `paths:`.
// - A file passes instructionFileBytes, or an import chain passes
//   importHops, so Claude Code skips it.
// - An AGENTS.md sits beside a CLAUDE.md that does not import it, so Claude
//   Code never reads it.
// - A name is a symlink to a file that does not exist, so nothing loads.
// Names symlinked to one file (CLAUDE.md -> AGENTS.md, GEMINI.md -> AGENTS.md)
// are checked once, under the original's path, which is the file to edit.
// Claude Code does not read GEMINI.md, so it counts only through such a link.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LIMITS, lineCount, severity, tokens } from "../lib/_budget.mjs";
import { emit, run } from "../lib/_common.mjs";
import { projectRoot, TAG } from "../lib/_core.mjs";
import { nodeIo } from "../lib/_io-node.mjs";

const CLAUDE_NAMES = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"];
const AGENTS_NAMES = ["AGENTS.md", ".claude/AGENTS.md"];
const LISTED = new Set(["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md"]);
const YELLOW = "\u001b[33m";
const RED = "\u001b[31m";
const RESET = "\u001b[0m";
const MAX_LISTED = 3;

/** Instruction files and GEMINI.md names in the repository, skipping what git ignores. */
function repoFiles(root) {
  try {
    return execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      },
    )
      .split("\0")
      .filter(
        (f) =>
          LISTED.has(path.basename(f)) ||
          path.basename(f) === "GEMINI.md" ||
          /(^|\/)\.claude\/rules\/.+\.md$/.test(f),
      )
      .map((f) => path.join(root, f));
  } catch {
    // Not a git repository: only the files found by name count.
    return [];
  }
}

/** Markdown files under a rules directory. */
function ruleFiles(dir) {
  try {
    return fs
      .readdirSync(dir, { recursive: true })
      .filter((f) => f.endsWith(".md"))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

const scoped = (text) =>
  /^---\r?\n[\s\S]*?^paths:/m.test(
    text.match(/^---\r?\n[\s\S]*?\r?\n---/)?.[0] ?? "",
  );

/** Split text into code and prose parts, so fenced code stays untouched. */
function mapProse(text, fn) {
  return text
    .split(/(^(?:```|~~~)[\s\S]*?^(?:```|~~~)[^\n]*$)/m)
    .map((part, i) => (i % 2 ? part : fn(part)))
    .join("");
}

/** The text Claude Code injects: block-level HTML comments removed. */
const stripComments = (text) =>
  mapProse(text, (prose) =>
    prose.replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*(\r?\n|$)/gm, ""),
  );

/** `@path` imports outside code spans and fenced code. */
function importTargets(text, dir, home) {
  const found = [];
  mapProse(text, (prose) => {
    const plain = prose.replace(/`[^`\n]*`/g, "");
    for (const [, raw] of plain.matchAll(/(?:^|\s)@([^\s`]+)/g)) {
      const candidates = [raw, raw.replace(/[.,;:)\]]+$/, "")];
      for (const c of candidates) {
        const file = c.startsWith("~/")
          ? path.join(home, c.slice(2))
          : path.resolve(dir, c);
        if (fs.existsSync(file)) {
          found.push(file);
          break;
        }
      }
    }
    return prose;
  });
  return found;
}

/** The working directory and every directory above it, outermost first. */
function chain(cwd) {
  const dirs = [];
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    dirs.unshift(dir);
    if (path.dirname(dir) === dir) return dirs;
  }
}

run((data) => {
  const home = os.homedir();
  const real = (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return p;
    }
  };
  const root = real(projectRoot(nodeIo(data), data));
  const cwd = real(data.cwd || root);
  const config = process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  const slashes = (p) => p.split(path.sep).join("/");
  const label = (file) =>
    `\`${
      file.startsWith(root + path.sep)
        ? slashes(path.relative(root, file))
        : file.startsWith(home + path.sep)
          ? `~${slashes(file.slice(home.length))}`
          : file
    }\``;

  const files = new Map();
  const broken = new Set();
  const skipped = [];
  const deep = [];

  /** The entry for one real file, or null when nothing loads from `file`. */
  function add(file) {
    let target;
    try {
      target = fs.realpathSync(file);
    } catch {
      // A dangling symlink loads nothing; a missing plain name is normal.
      try {
        if (fs.lstatSync(file).isSymbolicLink()) broken.add(file);
      } catch {}
      return null;
    }
    if (files.has(target)) return files.get(target);
    const stat = fs.statSync(target);
    if (!stat.isFile()) return null;
    if (severity(stat.size, LIMITS.instructionFileBytes)) {
      skipped.push({ real: target, bytes: stat.size });
      files.set(target, null);
      return null;
    }
    const raw = fs.readFileSync(target, "utf8");
    const text = stripComments(raw);
    const entry = { real: target, raw, text, startup: false, imports: null };
    files.set(target, entry);
    entry.imports = [];
    for (const imported of importTargets(raw, path.dirname(file), home)) {
      const child = add(imported);
      if (child) entry.imports.push(child);
    }
    return entry;
  }

  /** Mark an entry and its imports as loaded at start, up to the hop limit. */
  function markStartup(entry, hops = 0, seen = new Set()) {
    if (!entry || seen.has(entry.real)) return;
    seen.add(entry.real);
    entry.startup = true;
    for (const child of entry.imports) {
      if (severity(hops + 1, LIMITS.importHops)) {
        deep.push({ from: entry.real, to: child.real });
        continue;
      }
      markStartup(child, hops + 1, seen);
    }
  }

  // Loaded at session start.
  const global = add(path.join(config, "CLAUDE.md"));
  markStartup(global);
  for (const f of ruleFiles(path.join(config, "rules"))) {
    const entry = add(f);
    if (entry && !scoped(entry.raw)) markStartup(entry);
  }
  const dirs = chain(cwd);
  const claudeChain = dirs.flatMap((d) =>
    CLAUDE_NAMES.map((n) => path.join(d, n)),
  );
  const agentsChain = dirs.flatMap((d) =>
    AGENTS_NAMES.map((n) => path.join(d, n)),
  );
  // `~/.claude/CLAUDE.md` is also `.claude/CLAUDE.md` of the home directory,
  // but it is the global file and does not hide AGENTS.md.
  const claudeEntries = claudeChain.map(add).filter((e) => e && e !== global);
  for (const entry of claudeEntries) markStartup(entry);
  // Claude Code reads AGENTS.md only when no CLAUDE.md-family file is loaded.
  if (!claudeEntries.length) for (const f of agentsChain) markStartup(add(f));
  for (const f of ruleFiles(path.join(root, ".claude", "rules"))) {
    const entry = add(f);
    if (entry && !scoped(entry.raw)) markStartup(entry);
  }

  // Loaded later, or only through a link.
  const listed = repoFiles(root);
  for (const f of listed) if (path.basename(f) !== "GEMINI.md") add(f);
  for (const f of listed) {
    if (path.basename(f) !== "GEMINI.md") continue;
    try {
      fs.realpathSync(f);
    } catch {
      if (fs.lstatSync(f).isSymbolicLink()) broken.add(f);
    }
  }

  const entries = [...files.values()].filter(Boolean);
  const warnings = [];
  const say = (level, text) => warnings.push({ level, text });

  for (const { real: file, bytes } of skipped)
    say(
      "fail",
      `${label(file)} is ${(bytes / 1024 / 1024).toFixed(1)} MiB, over the 4 MiB limit, so Claude Code skips it.`,
    );
  for (const { from, to } of deep)
    say(
      "fail",
      `${label(from)} imports ${label(to)} more than ${LIMITS.importHops.fail} \`@\` hops from its \`CLAUDE.md\`, so Claude Code does not load it.`,
    );

  const long = entries
    .map((e) => ({ ...e, lines: lineCount(e.text) }))
    .map((e) => ({ ...e, level: severity(e.lines, LIMITS.instructionLines) }))
    .filter((e) => e.level)
    .sort((a, b) => b.lines - a.lines);
  for (const e of long.slice(0, MAX_LISTED))
    say(
      e.level,
      e.level === "fail"
        ? `${label(e.real)} has ${e.lines} lines, over the ${LIMITS.instructionLines.fail}-line limit for one instruction file.`
        : `${label(e.real)} has ${e.lines} lines, over the ${LIMITS.instructionLines.warn}-line target for one instruction file.`,
    );
  if (long.length > MAX_LISTED)
    say(
      "warn",
      `${long.length - MAX_LISTED} more instruction files are over the line target.`,
    );

  const startup = entries
    .filter((e) => e.startup)
    .map((e) => ({ ...e, tokens: tokens(e.text) }))
    .sort((a, b) => b.tokens - a.tokens);
  const total = startup.reduce((sum, e) => sum + e.tokens, 0);
  const level = severity(total, LIMITS.startupInstructionTokens);
  if (level) {
    const largest = startup
      .slice(0, MAX_LISTED)
      .map((e) => `${label(e.real)} (${e.tokens})`)
      .join(", ");
    say(
      level,
      `Instructions loaded at session start come to about ${total} tokens, over the ${
        level === "fail"
          ? `${LIMITS.startupInstructionTokens.fail}-token limit`
          : `${LIMITS.startupInstructionTokens.warn}-token target`
      }. Largest: ${largest}. Move what only some tasks need into rules with \`paths:\` or into skills.`,
    );
  }

  // An AGENTS.md is unread when a CLAUDE.md-family file loads in its place
  // and neither imports it nor links to it.
  const reached = new Set();
  const reach = (e) => {
    if (!e || reached.has(e.real)) return;
    reached.add(e.real);
    for (const child of e.imports) reach(child);
  };
  const nested = listed.filter((f) => CLAUDE_NAMES.includes(path.basename(f)));
  for (const f of [...claudeChain, ...nested]) reach(files.get(real(f)));
  const hasClaude = (dir) =>
    CLAUDE_NAMES.some((n) => fs.existsSync(path.join(dir, n)));
  const agents = new Set([
    ...(claudeEntries.length ? agentsChain : []),
    ...listed.filter(
      (f) =>
        path.basename(f) === "AGENTS.md" &&
        !dirs.includes(path.dirname(f)) &&
        hasClaude(path.dirname(f)),
    ),
  ]);
  for (const f of agents) {
    if (!fs.existsSync(f) || reached.has(real(f))) continue;
    say(
      "warn",
      `Claude Code does not read ${label(f)}, because a \`CLAUDE.md\` loads in its place. Add \`@AGENTS.md\` to that \`CLAUDE.md\`, or symlink one to the other.`,
    );
  }

  for (const file of broken)
    say(
      "warn",
      `${label(file)} is a symlink to \`${fs.readlinkSync(file)}\`, which does not exist, so it loads nothing.`,
    );

  if (!warnings.length) return;
  const order = { fail: 0, warn: 1 };
  emit({
    systemMessage: `${TAG} ${warnings
      .sort((a, b) => order[a.level] - order[b.level])
      .map(({ level, text }) =>
        level === "fail"
          ? `${RED}✖ ${text}${RESET}`
          : `${YELLOW}⚠ ${text}${RESET}`,
      )
      .join("\n")}`,
  });
});
