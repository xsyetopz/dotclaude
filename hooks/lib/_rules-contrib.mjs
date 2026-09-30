// Bash guard rules for contributions to projects that are not the user's:
// commits, pushes, pull requests, issues, discussions, reviews, and comments.
//
// A project that the AI policy catalog marks as forbidding AI contributions
// gets a deny. A push or GitHub write to another owner's repository gets an
// ask, so the user approves each contribution that an agent makes as them.

import { execFileSync } from "node:child_process";
import { forbids, lookup, remoteKey, updateNotice } from "./_ai-policies.mjs";
import { git, positional } from "./_bash-args.mjs";
import { gitCwd, gitSplit } from "./_rules-git.mjs";

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

let login;
/** The gh login for github.com, read from the local config (no network). */
function ghUser(ctx) {
  if (ctx.ghUser !== undefined) return ctx.ghUser;
  if (login === undefined) {
    try {
      login = execFileSync(
        "gh",
        ["config", "get", "user", "-h", "github.com"],
        {
          encoding: "utf8",
          timeout: 2000,
          stdio: ["ignore", "pipe", "ignore"],
        },
      )
        .trim()
        .toLowerCase();
    } catch {
      login = "";
    }
  }
  return login;
}

function remotes(cwd) {
  const out = git(cwd, ["remote", "-v"]) ?? "";
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
function contributionOf(cmd, ctx) {
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
      : [...remotes(ctx.cwd).values()].map(remoteKey).filter(Boolean);
    return { label, outward: true, keys };
  }
  if (cmd.name !== "git") return undefined;
  const { globals, sub, rest } = gitSplit(cmd.args);
  if (sub !== "commit" && sub !== "push") return undefined;
  const cwd = gitCwd(globals, ctx);
  const all = remotes(cwd);
  if (sub === "commit")
    return {
      label: "`git commit`",
      outward: false,
      keys: [...all.values()].map(remoteKey).filter(Boolean),
    };
  const target = positional(rest)[0];
  let url = target ? (all.get(target) ?? target) : undefined;
  if (!url) {
    const branch = git(cwd, ["branch", "--show-current"])?.trim();
    const name =
      (branch &&
        (
          git(cwd, ["config", `branch.${branch}.pushRemote`]) ??
          git(cwd, ["config", "remote.pushDefault"]) ??
          git(cwd, ["config", `branch.${branch}.remote`])
        )?.trim()) ||
      "origin";
    url = all.get(name);
  }
  const key = remoteKey(url);
  return { label: "`git push`", outward: true, keys: key ? [key] : [] };
}

/** @returns {import("./_bash-rules.mjs").Finding[]} */
export function contribution(cmd, ctx) {
  const act = contributionOf(cmd, ctx);
  if (act?.unknown)
    return [
      [
        "ask",
        `${act.label} writes to GitHub for the user, and the guard cannot tell the repository from the query. Before you approve, make sure that the target project accepts contributions made with AI (see its \`AI_POLICY.md\`, \`CONTRIBUTING.md\`, or \`AGENTS.md\`).`,
      ],
    ];
  if (!act?.keys.length) return [];
  for (const key of act.keys) {
    const entry = lookup(key);
    if (entry && forbids(entry))
      return [
        [
          "deny",
          `the project \`${entry.project}\` does not accept contributions made with AI (policy: ${entry.policy}). ${act.label} would contribute to it for the user. Stop all work that contributes to this project: commits, pushes, pull requests, issues, discussions, reviews, and comments. Tell the user about the policy.${updateNotice()}`,
        ],
      ];
  }
  if (!act.outward) return [];
  const user = ghUser(ctx);
  const foreign = act.keys.filter((key) => {
    const [host, owner] = key.split("/");
    return host === "github.com" && user && owner !== user;
  });
  if (!foreign.length) return [];
  const key = foreign[0];
  const entry = lookup(key);
  const listed = entry
    ? ` The AI policy list says for \`${entry.project}\`: AI allowed "${entry.allowed}", disclosure required "${entry.disclosure}", human in the loop "${entry.human}" (${entry.policy}).`
    : " The AI policy list has no entry for it, so its AI policy is possibly unwritten.";
  return [
    [
      "ask",
      `${act.label} contributes to \`${key.replace(/^github\.com\//, "")}\`, a repository that you do not own. Before you approve, make sure that the project accepts contributions made with AI (see its \`AI_POLICY.md\`, \`CONTRIBUTING.md\`, \`AGENTS.md\`, or pull request template).${listed}${updateNotice()}`,
    ],
  ];
}
