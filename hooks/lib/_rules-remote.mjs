// Bash guard rules for actions visible to others: gh writes, registry
// publishes, and uploads of local files.

import { hasFlag, positional } from "./_bash-args.mjs";

// --- GitHub and publishing --------------------------------------------------

const GH_WRITES = {
  pr: [
    "create",
    "merge",
    "close",
    "reopen",
    "comment",
    "review",
    "edit",
    "ready",
    "lock",
    "unlock",
  ],
  issue: [
    "create",
    "close",
    "reopen",
    "comment",
    "edit",
    "delete",
    "transfer",
    "lock",
    "unlock",
    "pin",
    "unpin",
  ],
  release: ["create", "delete", "edit", "upload", "delete-asset"],
  repo: [
    "create",
    "delete",
    "archive",
    "unarchive",
    "rename",
    "edit",
    "fork",
    "sync",
  ],
  gist: ["create", "edit", "delete", "rename"],
  workflow: ["run", "enable", "disable"],
  run: ["rerun", "cancel", "delete"],
  secret: ["set", "delete", "remove"],
  variable: ["set", "delete"],
  label: ["create", "delete", "edit", "clone"],
};

export function gh(cmd) {
  const pos = positional(cmd.args);
  if (!pos.length) return [];
  if (pos[0] === "api") {
    let method = null;
    cmd.args.forEach((a, i) => {
      if ((a === "-X" || a === "--method") && cmd.args[i + 1])
        method = cmd.args[i + 1].toUpperCase();
      else if (a.startsWith("--method="))
        method = a.split("=")[1].toUpperCase();
      else if (/^-X./.test(a)) method = a.slice(2).toUpperCase();
    });
    const fields = hasFlag(
      cmd.args,
      ["--field", "--raw-field", "--input"],
      "fF",
    );
    if ((method && method !== "GET") || (fields && method !== "GET"))
      return [
        ["ask", `\`gh api\` ${method ?? "POST"} writes to GitHub as you`],
      ];
    return [];
  }
  const action = pos[1] ?? "";
  return (GH_WRITES[pos[0]] ?? []).includes(action)
    ? [["ask", `\`gh ${pos[0]} ${action}\` acts on GitHub as you`]]
    : [];
}

export const PUBLISH = {
  npm: ["publish", "unpublish", "deprecate"],
  pnpm: ["publish"],
  bun: ["publish"],
  cargo: ["publish", "yank"],
  twine: ["upload"],
  gem: ["push"],
  poetry: ["publish"],
  uv: ["publish"],
  docker: ["push"],
  podman: ["push"],
  mvn: ["deploy"],
  vsce: ["publish"],
  ovsx: ["publish"],
};

export function publish(cmd) {
  const pos = positional(cmd.args);
  if (cmd.name === "yarn")
    return pos[0] === "publish" || (pos[0] === "npm" && pos[1] === "publish")
      ? [["ask", "`yarn publish` publishes to a public registry"]]
      : [];
  return (PUBLISH[cmd.name] ?? []).includes(pos[0])
    ? [["ask", `\`${cmd.name} ${pos[0]}\` publishes to a public registry`]]
    : [];
}

export function curl(cmd) {
  const args = cmd.args;
  if (
    args.some((a) =>
      /(^|\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])([:/]|$)/.test(a),
    )
  )
    return [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    const next = args[i + 1] ?? "";
    if (a === "-T" || a === "--upload-file")
      return [["ask", `\`${cmd.name}\` uploads a local file`]];
    if (
      [
        "-d",
        "--data",
        "--data-binary",
        "--data-raw",
        "--data-urlencode",
        "-F",
        "--form",
        "--json",
      ].includes(a) &&
      next.startsWith("@")
    ) {
      return [
        ["ask", `\`${cmd.name}\` sends the contents of ${next.slice(1)}`],
      ];
    }
    if (/^(-d|-F)@/.test(a) || /^--(data|data-binary|form|json)=@/.test(a))
      return [["ask", `\`${cmd.name}\` sends the contents of a local file`]];
  }
  return [];
}

export function wget(cmd) {
  return cmd.args.some((a) => a.startsWith("--post-file"))
    ? [["ask", "`wget --post-file` sends a local file"]]
    : [];
}
