// Bash guard rules for contributions to projects that are not the user's:
// commits, pushes, pull requests, issues, discussions, reviews, and comments.
//
// A project that the AI policy catalog marks as forbidding AI contributions
// gets a deny. A push or GitHub write to another owner's repository gets an
// ask, so the user approves each contribution that an agent makes as them.

import { forbids, lookup, remoteKey, updateNotice } from "./_ai-policies.mjs";
import { git, positional } from "./_bash-args.mjs";
import { pathFor } from "./_path.mjs";
import { gitCwd, gitSplit } from "./_rules-git.mjs";
import { parseYaml } from "./_yaml.mjs";

// gh writes that add content under the user's name to a project.
const CONTRIBUTES = {
  pr: new Set(["create", "comment", "review", "edit", "reopen", "ready"]),
  issue: new Set(["create", "comment", "edit", "reopen"]),
  discussion: new Set(["create", "comment", "edit"]),
};
// GraphQL mutations that post content. The query names the repository by a
// node ID, so the guard cannot tell the target.
const GRAPHQL_WRITE =
  /\b(create(Discussion|Issue|PullRequest)|add(Discussion|PullRequestReview)?Comment|addPullRequestReview|update(Discussion|Issue|PullRequest)(Comment)?)\b/;
const API_WRITE =
  /^\/?repos\/([^/]+)\/([^/]+)\/(pulls|issues|comments|git|contents|merges)\b/;
// The old `execFileSync` of `gh` stopped at 1 MiB of output and after 2 s.
const GH_MAX_BYTES = 1024 * 1024;
const GH_TIMEOUT_MS = 2000;

/** gh's config directory, found as gh finds it. */
function ghConfigDir(io, env) {
  const path = pathFor(io.platform);
  if (env.GH_CONFIG_DIR) return env.GH_CONFIG_DIR;
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, "gh");
  if (io.platform === "win32" && env.AppData)
    return path.join(env.AppData, "GitHub CLI");
  return path.join(io.home, ".config", "gh");
}

/**
 * The github.com login in gh's `hosts.yml` ("" when it has none), or
 * undefined when the file cannot be read or parsed. gh keeps the login there
 * also when the token is in the system keyring.
 */
export async function hostsUser(io, env = io.env) {
  try {
    const file = pathFor(io.platform).join(ghConfigDir(io, env), "hosts.yml");
    const hosts = parseYaml(await io.fs.read(file));
    const user = hosts?.["github.com"]?.user;
    return typeof user === "string" ? user.trim().toLowerCase() : "";
  } catch {
    return undefined;
  }
}

let login;
/** The gh login for github.com, read from the local config (no network). */
async function ghUser(ctx) {
  if (ctx.ghUser !== undefined) return ctx.ghUser;
  // Reading `hosts.yml` costs under 1 ms. Starting `gh` costs about 50 ms.
  login ??= await hostsUser(ctx.io);
  if (login === undefined) {
    try {
      const r = await ctx.io.run(
        ["gh", "config", "get", "user", "-h", "github.com"],
        { timeoutMs: GH_TIMEOUT_MS, maxBytes: GH_MAX_BYTES },
      );
      login = r.exitCode === 0 ? r.stdout.trim().toLowerCase() : "";
    } catch {
      login = "";
    }
  }
  return login;
}

async function remotes(io, cwd) {
  const out = (await git(io, cwd, ["remote", "-v"])) ?? "";
  const byName = new Map();
  for (const line of out.split("\n")) {
    const [name, url] = line.split(/\s+/);
    if (name && url && !byName.has(name)) byName.set(name, url);
  }
  return byName;
}

/** Key of `-R`/`--repo` values: `owner/repo`, `host/owner/repo`, or a URL. */
function repoArgKey(value) {
  if (/^https?:\/\//.test(value)) return remoteKey(value);
  const parts = value.toLowerCase().split("/");
  if (parts.length === 2) return `github.com/${parts.join("/")}`;
  return parts.length === 3 ? parts.join("/") : undefined;
}

function flagValue(args, short, long) {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if ((a === short || a === long) && args[i + 1]) return args[i + 1];
    if (a.startsWith(`${long}=`)) return a.slice(long.length + 1);
  }
  return undefined;
}

/** What the command contributes, and to which repository keys. */
async function contributionOf(cmd, ctx) {
  if (cmd.name === "gh") {
    const pos = positional(cmd.args);
    if (pos[0] === "api" && pos[1] === "graphql") {
      const query = cmd.args.find((a) => GRAPHQL_WRITE.test(a));
      if (!query || !/\bmutation\b/.test(cmd.args.join(" "))) return undefined;
      return {
        label: `\`gh api graphql\` (\`${GRAPHQL_WRITE.exec(query)[0]}\`)`,
        outward: true,
        unknown: true,
        keys: [],
      };
    }
    if (pos[0] === "api") {
      const m = cmd.args.map((a) => API_WRITE.exec(a)).find(Boolean);
      const write = cmd.args.some((a) =>
        /^(-X|--method=?)?(POST|PATCH|PUT|DELETE)$/i.test(a),
      );
      const fields = cmd.args.some((a) =>
        /^(-f|-F|--field|--raw-field|--input)(=|$)/.test(a),
      );
      if (!m || !(write || fields)) return undefined;
      return {
        label: "`gh api`",
        outward: true,
        keys: [`github.com/${m[1]}/${m[2]}`.toLowerCase()],
      };
    }
    if (!CONTRIBUTES[pos[0]]?.has(pos[1])) return undefined;
    const label = `\`gh ${pos[0]} ${pos[1]}\``;
    const repo = flagValue(cmd.args, "-R", "--repo");
    const urls = cmd.args.filter((a) => /^https?:\/\//.test(a));
    const named = [repo && repoArgKey(repo), ...urls.map(remoteKey)].filter(
      Boolean,
    );
    // gh picks the base repository among the remotes, so each one counts.
    const keys = named.length
      ? named
      : [...(await remotes(ctx.io, ctx.cwd)).values()]
          .map(remoteKey)
          .filter(Boolean);
    return { label, outward: true, keys };
  }
  if (cmd.name !== "git") return undefined;
  const { globals, sub, rest } = gitSplit(cmd.args);
  if (sub !== "commit" && sub !== "push") return undefined;
  const cwd = gitCwd(globals, ctx);
  const all = await remotes(ctx.io, cwd);
  if (sub === "commit")
    return {
      label: "`git commit`",
      outward: false,
      keys: [...all.values()].map(remoteKey).filter(Boolean),
    };
  const target = positional(rest)[0];
  let url = target ? (all.get(target) ?? target) : undefined;
  if (!url) {
    const branch = (
      await git(ctx.io, cwd, ["branch", "--show-current"])
    )?.trim();
    const name =
      (branch &&
        (
          (await git(ctx.io, cwd, ["config", `branch.${branch}.pushRemote`])) ??
          (await git(ctx.io, cwd, ["config", "remote.pushDefault"])) ??
          (await git(ctx.io, cwd, ["config", `branch.${branch}.remote`]))
        )?.trim()) ||
      "origin";
    url = all.get(name);
  }
  const key = remoteKey(url);
  return { label: "`git push`", outward: true, keys: key ? [key] : [] };
}

/** @returns {import("./_bash-rules.mjs").Finding[]} */
export async function contribution(cmd, ctx) {
  const act = await contributionOf(cmd, ctx);
  if (act?.unknown)
    return [
      [
        "ask",
        `${act.label} writes to GitHub for the user, and the guard cannot tell the repository from the query. Before you approve, make sure that the target project accepts contributions made with AI (see its \`AI_POLICY.md\`, \`CONTRIBUTING.md\`, or \`AGENTS.md\`).`,
      ],
    ];
  if (!act?.keys.length) return [];
  for (const key of act.keys) {
    const entry = await lookup(ctx.io, key);
    if (entry && forbids(entry))
      return [
        [
          "deny",
          `the project \`${entry.project}\` does not accept contributions made with AI (policy: ${entry.policy}). ${act.label} would contribute to it for the user. Stop all work that contributes to this project: commits, pushes, pull requests, issues, discussions, reviews, and comments. Tell the user about the policy.${await updateNotice(ctx.io)}`,
        ],
      ];
  }
  if (!act.outward) return [];
  const user = await ghUser(ctx);
  const foreign = act.keys.filter((key) => {
    const [host, owner] = key.split("/");
    return host === "github.com" && user && owner !== user;
  });
  if (!foreign.length) return [];
  const key = foreign[0];
  const entry = await lookup(ctx.io, key);
  const listed = entry
    ? ` The AI policy list says for \`${entry.project}\`: AI allowed "${entry.allowed}", disclosure required "${entry.disclosure}", human in the loop "${entry.human}" (${entry.policy}).`
    : " The AI policy list has no entry for it, so its AI policy is possibly unwritten.";
  return [
    [
      "ask",
      `${act.label} contributes to \`${key.replace(/^github\.com\//, "")}\`, a repository that you do not own. Before you approve, make sure that the project accepts contributions made with AI (see its \`AI_POLICY.md\`, \`CONTRIBUTING.md\`, \`AGENTS.md\`, or pull request template).${listed}${await updateNotice(ctx.io)}`,
    ],
  ];
}
