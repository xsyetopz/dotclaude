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
 * The usage windows from the `/usage` copy that Claude Code keeps in
 * `.claude.json`, in the shape of the status JSON's `rate_limits`. Claude
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
        const window = (w) =>
          Number.isFinite(w?.utilization) && Date.parse(w.resets_at) > now
            ? {
                used_percentage: w.utilization,
                resets_at: Date.parse(w.resets_at) / 1000,
              }
            : undefined;
        const { five_hour, seven_day } = copy.utilization;
        return { five_hour: window(five_hour), seven_day: window(seven_day) };
      } catch {
        return null;
      }
    },
    now,
  );
}
