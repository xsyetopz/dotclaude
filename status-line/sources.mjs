// What the status line reads besides its input. The line runs every
// `STATUS_REFRESH_SECONDS`, so a slow result (`git status`, the compaction
// count, the usage copy) goes through `cached`: a temp file keyed by the
// input, reused for `STATUS_CACHE_MS`. 0.19 ran `git status` and read the
// transcript on each run. Nothing here calls a model or the network.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { STATUS_CACHE_MS } from "../hooks/lib/_budget.mjs";

/** `compute(previous value)`, run at most once per `STATUS_CACHE_MS` per key. */
export function cached(key, compute, now = Date.now()) {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);
  const file = path.join(os.tmpdir(), `dotclaude-status-${hash}.json`);
  let prev;
  try {
    prev = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // No copy yet, or another run is writing it.
  }
  if (prev && now - prev.at >= 0 && now - prev.at < STATUS_CACHE_MS)
    return prev.value;
  const value = compute(prev?.value);
  try {
    fs.writeFileSync(file, JSON.stringify({ at: now, value }));
  } catch {
    // The value is right. Only the next run computes it again.
  }
  return value;
}

/** Branch, changed files, and commits ahead and behind, or null. */
export const gitState = (dir, now) =>
  cached(
    `git ${dir}`,
    () => {
      const res = spawnSync(
        "git",
        ["--no-optional-locks", "-C", dir, "status", "--porcelain=v2", "-b"],
        { encoding: "utf8", timeout: 1500 },
      );
      if (res.status !== 0 || !res.stdout) return null;
      const out = { branch: null, dirty: 0, ahead: 0, behind: 0 };
      let oid = null;
      for (const line of res.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) out.branch = line.slice(14);
        else if (line.startsWith("# branch.oid ")) oid = line.slice(13, 20);
        else if (line.startsWith("# branch.ab ")) {
          const m = /\+(\d+) -(\d+)/.exec(line);
          if (m) [out.ahead, out.behind] = [Number(m[1]), Number(m[2])];
        } else if (line && !line.startsWith("#")) out.dirty++;
      }
      if (out.branch === "(detached)") out.branch = oid;
      return out;
    },
    now,
  );

/**
 * Compactions in a transcript. It reads only the bytes appended since the
 * last count, because a transcript can be tens of MB.
 */
export function compactions(transcript, now) {
  if (!transcript) return 0;
  const state = cached(
    `compactions ${transcript}`,
    (prev) => {
      try {
        const size = fs.statSync(transcript).size;
        let { offset, count } = prev ?? { offset: 0, count: 0 };
        if (size < offset) [offset, count] = [0, 0];
        const bytes = Buffer.alloc(size - offset);
        const fd = fs.openSync(transcript, "r");
        fs.readSync(fd, bytes, 0, bytes.length, offset);
        fs.closeSync(fd);
        // Stop at the last complete line. A quote inside a message is escaped
        // in JSON, so the marker finds only a real boundary entry.
        const end = bytes.lastIndexOf(0x0a) + 1;
        const text = bytes.subarray(0, end).toString("utf8");
        count += text.split('"subtype":"compact_boundary"').length - 1;
        return { offset: offset + end, count };
      } catch {
        return prev ?? { offset: 0, count: 0 };
      }
    },
    now,
  );
  return state.count;
}

/** `{done, total}` of a `slices` run in `root`, or null when it has none. */
export function loopProgress(root) {
  try {
    const file = path.join(root, ".dotclaude", "loop", "slices.jsonl");
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    const slices = lines.flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return []; // A line that Claude is writing now.
      }
    });
    const done = slices.filter((s) => s?.status === "merged").length;
    return slices.length ? { done, total: slices.length } : null;
  } catch {
    return null;
  }
}

/**
 * The `/usage` copy that Claude Code keeps in `.claude.json`: the usage
 * windows in the shape of the status JSON's `rate_limits`, the limit resets
 * (`cedar_ember`) that the user can spend, and the extra usage spend. Claude
 * Code sends the status JSON's windows only after the first API response, and
 * treats the copy as stale after an hour.
 */
export function usageCopy(env = process.env, now = Date.now()) {
  const file = path.join(env.CLAUDE_CONFIG_DIR || os.homedir(), ".claude.json");
  return cached(
    `usage ${file}`,
    () => {
      try {
        const copy = JSON.parse(
          fs.readFileSync(file, "utf8"),
        ).cachedUsageUtilization;
        if (!(now - copy.fetchedAtMs < 3_600_000)) return null;
        return parseUsage(copy.utilization, now);
      } catch {
        return null;
      }
    },
    now,
  );
}

/** `usageCopy` without the file and the cache. Each part is undefined when absent. */
export function parseUsage(usage, now) {
  const window = (w) =>
    Number.isFinite(w?.utilization) && Date.parse(w.resets_at) > now
      ? {
          used_percentage: w.utilization,
          resets_at: Date.parse(w.resets_at) / 1000,
        }
      : undefined;
  return {
    five_hour: window(usage?.five_hour),
    seven_day: window(usage?.seven_day),
    resets: limitResets(usage?.cedar_ember, now),
    extra: extraUsage(usage?.extra_usage),
  };
}

/**
 * `{left, until}`: the resets that the user can spend now, and the earliest
 * expiry in seconds (null when none expires). The rules are those of Claude
 * Code and CodexBar: a grant counts when it is not paused, has resets left,
 * and `now` is in its open `starts_at` to `ends_at` span.
 */
function limitResets(block, now) {
  if (block?.eligible !== true || !Array.isArray(block.grants))
    return undefined;
  let left = 0;
  let until = null;
  for (const g of block.grants) {
    const start = g?.starts_at == null ? -Infinity : Date.parse(g.starts_at);
    const end = g?.ends_at == null ? Infinity : Date.parse(g.ends_at);
    if (
      g?.paused !== false ||
      !(Number.isInteger(g.resets_left) && g.resets_left > 0)
    )
      continue;
    if (!(start <= now && end > now)) continue;
    left += g.resets_left;
    if (Number.isFinite(end) && (until === null || end / 1000 < until))
      until = end / 1000;
  }
  return left ? { left, until } : undefined;
}

/**
 * `{used, limit, pct, currency}` of the extra usage spend while it is on.
 * The copy gives amounts in minor units (cents for USD), and `limit` is null
 * when the plan sets no monthly limit.
 */
function extraUsage(extra) {
  if (extra?.is_enabled !== true || !Number.isFinite(extra.used_credits))
    return undefined;
  const scale =
    10 ** (Number.isInteger(extra.decimal_places) ? extra.decimal_places : 2);
  const limit =
    Number.isFinite(extra.monthly_limit) && extra.monthly_limit > 0
      ? extra.monthly_limit / scale
      : null;
  const used = extra.used_credits / scale;
  return {
    used,
    limit,
    pct: Number.isFinite(extra.utilization)
      ? extra.utilization
      : limit && (used / limit) * 100,
    currency: extra.currency || "USD",
  };
}
