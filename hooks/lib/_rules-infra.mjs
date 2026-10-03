// Bash guard rules for infrastructure changes, new dependencies, turned-off
// TLS verification, and deleted test files.
// Every finding is an `ask`.

import { git, hasFlag, isFlagCluster, targets } from "./_bash-args.mjs";
import { TEST_PATH } from "./_edit-rules.mjs";
import { language } from "./_interpreters.mjs";
import { pathFor } from "./_path.mjs";
import { resolveTarget } from "./_rules-filesystem.mjs";
import { gitSplit } from "./_rules-git.mjs";
import { parseYaml } from "./_yaml.mjs";

// --- helpers ----------------------------------------------------------------

/**
 * The operands of a command line: its arguments without flags and without
 * the values of `valueFlags`.
 * Each argument after `--` is an operand.
 */
function operands(args, valueFlags = new Set()) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--") {
      out.push(...args.slice(i + 1));
      break;
    }
    if (valueFlags.has(a)) i += 1;
    else if (!a.startsWith("-")) out.push(a);
  }
  return out;
}

/** The value of a flag in the forms `--flag value` and `--flag=value`. */
function flagValue(args, names) {
  for (let i = 0; i < args.length; i += 1) {
    for (const n of names) {
      if (args[i] === n && i + 1 < args.length) return args[i + 1];
      if (n.startsWith("--") && args[i].startsWith(`${n}=`))
        return args[i].slice(n.length + 1);
    }
  }
  return undefined;
}

function envValue(cmd, ctx, name) {
  return cmd.assigns?.[name] ?? ctx.env?.[name] ?? ctx.io.env[name];
}

/** The text of a file, or undefined when it cannot be read. */
async function readText(io, file) {
  try {
    const stat = await io.fs.stat(file);
    return stat.kind === "file" && stat.size < 2_000_000
      ? await io.fs.read(file)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Combine two handler tables.
 * A name in both tables runs both handlers.
 */
export function merge(base, ...extras) {
  const out = { ...base };
  for (const extra of extras)
    for (const [name, handler] of Object.entries(extra)) {
      const first = out[name];
      out[name] = first
        ? async (cmd, ctx) => [
            ...(await first(cmd, ctx)),
            ...(await handler(cmd, ctx)),
          ]
        : handler;
    }
  return out;
}

// --- infrastructure ---------------------------------------------------------

const TF_VALUE_FLAGS = new Set([
  "-var",
  "-var-file",
  "-target",
  "-replace",
  "-state",
  "-out",
  "-parallelism",
  "-lock-timeout",
  "-backend-config",
]);
const KUBE_VALUE_FLAGS = new Set([
  "--context",
  "--namespace",
  "-n",
  "--kubeconfig",
  "--cluster",
  "--user",
  "--server",
  "-s",
  "--token",
  "--as",
  "--as-group",
  "--as-uid",
  "-v",
  "--v",
  "--request-timeout",
  "--cache-dir",
  "--certificate-authority",
  "--client-certificate",
  "--client-key",
  "--tls-server-name",
  "--username",
  "--password",
  "--profile",
  "--profile-output",
]);
const HELM_VALUE_FLAGS = new Set([
  "--kube-context",
  "--namespace",
  "-n",
  "--kubeconfig",
  "--kube-as-user",
  "--kube-as-group",
  "--kube-token",
  "--kube-apiserver",
  "--kube-ca-file",
  "--burst-limit",
  "--qps",
  "--registry-config",
  "--repository-cache",
  "--repository-config",
]);
const AWS_VALUE_FLAGS = new Set([
  "--profile",
  "--region",
  "--output",
  "--query",
  "--endpoint-url",
  "--color",
]);
const CLOUD_VALUE_FLAGS = new Set([
  "--project",
  "--account",
  "--configuration",
  "--format",
  "--filter",
  "--zone",
  "--region",
  "--subscription",
  "--resource-group",
  "-g",
  "--output",
  "-o",
]);

const PULUMI_VALUE_FLAGS = new Set([
  "-s",
  "--stack",
  "-C",
  "--cwd",
  "--color",
  "--tracing",
  "--profiling",
  "-v",
  "--verbose",
  "-m",
  "--message",
  "-c",
  "--config",
  "--config-file",
  "-p",
  "--parallel",
]);
const CDK_VALUE_FLAGS = new Set([
  "-a",
  "--app",
  "--profile",
  "-c",
  "--context",
  "-o",
  "--output",
  "-r",
  "--role-arn",
  "--proxy",
  "--ca-bundle-path",
  "--plugin",
  "-p",
  "--toolkit-stack-name",
]);
const FLY_VALUE_FLAGS = new Set([
  "-a",
  "--app",
  "-c",
  "--config",
  "-t",
  "--access-token",
  "-o",
  "--org",
  "-r",
  "--region",
]);

// The first of these in a cloud command is its verb.
// `gcloud compute instances describe delete` describes an instance named `delete`.
const CLOUD_VERBS = new Set([
  "delete",
  "describe",
  "list",
  "create",
  "update",
  "get",
  "show",
  "set",
  "add",
  "remove",
  "start",
  "stop",
  "restart",
  "deploy",
  "import",
  "export",
  "ssh",
  "cancel",
  "run",
  "execute",
  "get-value",
  "config-ssh",
]);

const HELP_FLAGS = new Set(["-h", "-help", "--help"]);

/** Findings `[label, effect]` of an infrastructure command. */
function infraActions(cmd) {
  const args = cmd.args;
  // Help and a dry run change nothing.
  if (args.some((a) => HELP_FLAGS.has(a))) return [];
  if (
    cmd.name === "kubectl" &&
    args.some((a) => /^--dry-run(=(client|server|true))?$/.test(a))
  )
    return [];
  const label = (rest) => `${cmd.name} ${rest}`;
  switch (cmd.name) {
    case "terraform":
    case "tofu":
    case "terragrunt": {
      const ops = operands(args, TF_VALUE_FLAGS).filter(
        (o) => o !== "run-all" && o !== "run",
      );
      // `TF_CLI_ARGS` and `TF_CLI_ARGS_<command>` add arguments.
      const all = [
        ...args,
        ...Object.entries(cmd.assigns ?? {})
          .filter(([k]) => k === "TF_CLI_ARGS" || k === `TF_CLI_ARGS_${ops[0]}`)
          .flatMap(([, v]) => String(v).split(/\s+/)),
      ];
      if (ops[0] === "destroy")
        return [[label("destroy"), "deletes the resources that it manages"]];
      if (ops[0] === "apply") {
        if (
          cmd.name === "terragrunt" &&
          all.some((a) => /^--(terragrunt-)?non-interactive$/.test(a))
        )
          return [
            [
              label("apply --terragrunt-non-interactive"),
              "applies changes without a review of the plan",
            ],
          ];
        if (all.some((a) => /^--?destroy(=true)?$/.test(a)))
          return [
            [label("apply -destroy"), "deletes the resources that it manages"],
          ];
        if (all.some((a) => /^--?auto-approve(=true)?$/.test(a)))
          return [
            [
              label("apply -auto-approve"),
              "applies changes without a review of the plan",
            ],
          ];
      }
      if (ops[0] === "state" && ["rm", "mv", "push"].includes(ops[1]))
        return [
          [
            label(`state ${ops[1]}`),
            "changes the state that tracks the infrastructure",
          ],
        ];
      return [];
    }
    case "pulumi": {
      const sub = operands(args, PULUMI_VALUE_FLAGS)[0];
      if (sub === "destroy")
        return [[label("destroy"), "deletes the resources of the stack"]];
      if (sub === "up" && hasFlag(args, ["--yes"], "y"))
        return [
          [
            label("up --yes"),
            "applies changes without a review of the preview",
          ],
        ];
      return [];
    }
    case "cdk":
      return operands(args, CDK_VALUE_FLAGS)[0] === "destroy"
        ? [[label("destroy"), "deletes the stacks and their resources"]]
        : [];
    case "kubectl": {
      const sub = operands(args, KUBE_VALUE_FLAGS)[0];
      if (sub === "delete")
        return [[label("delete"), "deletes cluster resources"]];
      if (sub === "drain")
        return [[label("drain"), "evicts the pods from a node"]];
      if (sub === "replace" && hasFlag(args, ["--force"]))
        return [
          [
            label("replace --force"),
            "deletes the resource and creates it again",
          ],
        ];
      if (sub === "apply" && hasFlag(args, ["--prune"]))
        return [
          [
            label("apply --prune"),
            "deletes the resources that the applied files do not list",
          ],
        ];
      return [];
    }
    case "helm": {
      const sub = operands(args, HELM_VALUE_FLAGS)[0];
      if (["uninstall", "delete", "del", "un"].includes(sub))
        return [[label(sub), "removes a release and its resources"]];
      if (sub === "rollback")
        return [[label("rollback"), "reverts a release to an older revision"]];
      return [];
    }
    case "aws": {
      const [service, op] = operands(args, AWS_VALUE_FLAGS);
      if (/^(delete|terminate)-/.test(op ?? ""))
        return [[label(`${service} ${op}`), "deletes or ends cloud resources"]];
      if (service === "s3" && op === "rm" && hasFlag(args, ["--recursive"]))
        return [
          [label("s3 rm --recursive"), "deletes all objects under the path"],
        ];
      if (service === "s3" && op === "rb" && hasFlag(args, ["--force"]))
        return [
          [label("s3 rb --force"), "deletes a bucket and all of its objects"],
        ];
      return [];
    }
    case "gcloud":
    case "az":
      return operands(args, CLOUD_VALUE_FLAGS).find((o) =>
        CLOUD_VERBS.has(o),
      ) === "delete"
        ? [[label("... delete"), "deletes cloud resources"]]
        : [];
    case "fly":
    case "flyctl": {
      const ops = operands(args, FLY_VALUE_FLAGS);
      if (ops[0] === "destroy")
        return [[label("destroy"), "deletes the app and its data"]];
      return ops[0] === "apps" && ops[1] === "destroy"
        ? [[label("apps destroy"), "deletes the app and its data"]]
        : [];
    }
    default:
      return [];
  }
}

/** The `current-context` of the first kubeconfig file that names one. */
async function kubeContext(cmd, ctx) {
  const { io } = ctx;
  const path = pathFor(io.platform);
  const given =
    flagValue(cmd.args, ["--kubeconfig"]) ?? envValue(cmd, ctx, "KUBECONFIG");
  const files = given
    ? given.split(io.platform === "win32" ? ";" : ":").filter(Boolean)
    : [path.join(io.home, ".kube", "config")];
  for (const file of files) {
    const text = await readText(io, file);
    if (text === undefined) continue;
    try {
      const name = parseYaml(text)?.["current-context"];
      if (typeof name === "string" && name) return name;
    } catch {
      // A file that the parser cannot read gives no finding change.
    }
  }
  return undefined;
}

/** What shows the target of the command, as text for the reason. */
async function targetSentence(cmd, ctx) {
  const parts = [];
  switch (cmd.name) {
    case "kubectl":
    case "helm": {
      const flag = cmd.name === "helm" ? "--kube-context" : "--context";
      const context =
        flagValue(cmd.args, [flag]) ?? (await kubeContext(cmd, ctx));
      const namespace = flagValue(cmd.args, ["--namespace", "-n"]);
      if (context) parts.push(`context \`${context}\``);
      if (namespace) parts.push(`namespace \`${namespace}\``);
      break;
    }
    case "aws": {
      const profile =
        flagValue(cmd.args, ["--profile"]) ?? envValue(cmd, ctx, "AWS_PROFILE");
      if (profile) parts.push(`profile \`${profile}\``);
      break;
    }
    case "terraform":
    case "tofu":
    case "terragrunt": {
      let workspace = envValue(cmd, ctx, "TF_WORKSPACE");
      if (!workspace) {
        const path = pathFor(ctx.io.platform);
        const chdir = flagValue(cmd.args, ["-chdir"]);
        const dir = chdir ? path.resolve(ctx.cwd, chdir) : ctx.cwd;
        workspace = (
          await readText(ctx.io, path.join(dir, ".terraform", "environment"))
        )?.trim();
      }
      if (workspace) parts.push(`workspace \`${workspace}\``);
      break;
    }
    default:
  }
  return parts.length
    ? `The target is ${parts.join(", ")}. Check that this is the target that the user wants.`
    : "The target is not known. Ask the user to confirm the target.";
}

export async function infra(cmd, ctx) {
  const actions = infraActions(cmd);
  if (!actions.length) return [];
  const target = await targetSentence(cmd, ctx);
  return actions.map(([label, effect]) => [
    "ask",
    `\`${label}\` ${effect}. ${target}`,
  ]);
}

// --- new dependencies -------------------------------------------------------

const LOCKFILE_FLAGS = [
  "--frozen-lockfile",
  "--immutable",
  "--frozen",
  "--locked",
];

const PIP_VALUE_FLAGS = new Set([
  "-r",
  "--requirement",
  "-c",
  "--constraint",
  "-e",
  "--editable",
  "-i",
  "--index-url",
  "--extra-index-url",
  "-t",
  "--target",
  "--prefix",
  "--python",
  "-f",
  "--find-links",
  "--trusted-host",
  "--allow-insecure-host",
  "--progress-bar",
  "--python-version",
  "--platform",
  "--implementation",
  "--abi",
  "--root",
  "--src",
  "--upgrade-strategy",
  "--cert",
  "--proxy",
  "--retries",
  "--timeout",
  "--log",
  "--cache-dir",
  "--no-binary",
  "--only-binary",
  "--config-settings",
  "-C",
  "--report",
  "--index",
  "--exists-action",
  "--use-feature",
]);
const NODE_VALUE_FLAGS = new Set([
  "-F",
  "-C",
  "--dir",
  "--loglevel",
  "--omit",
  "--include",
  "--userconfig",
  "--globalconfig",
  "--scope",
  "--save-prefix",
  "--prefix",
  "--registry",
  "--workspace",
  "--filter",
  "--cwd",
  "--cache",
  "--tag",
]);
const UV_VALUE_FLAGS = new Set([
  ...PIP_VALUE_FLAGS,
  "--group",
  "--optional",
  "--extra",
  "--package",
  "--project",
]);
const POETRY_VALUE_FLAGS = new Set([
  "--group",
  "-G",
  "--source",
  "--extras",
  "-E",
  "--python",
  "-C",
  "--directory",
]);
const CARGO_VALUE_FLAGS = new Set([
  "--features",
  "-F",
  "--package",
  "-p",
  "--rename",
  "--git",
  "--registry",
  "--branch",
  "--tag",
  "--rev",
  "--manifest-path",
  "--target",
]);
const GEM_VALUE_FLAGS = new Set([
  "-v",
  "--version",
  "-s",
  "--source",
  "-i",
  "--install-dir",
  "-n",
  "--bindir",
  "-P",
  "--trust-policy",
]);
const COMPOSER_VALUE_FLAGS = new Set(["-d", "--working-dir"]);
const DOTNET_VALUE_FLAGS = new Set([
  "-v",
  "--version",
  "-s",
  "--source",
  "-f",
  "--framework",
  "--package-directory",
  "-p",
  "--project",
]);

// A path or an archive on disk is not a name in a registry.
const LOCAL_SPEC =
  /^(\.{1,2}([/\\[]|$)|[/\\~]|[A-Za-z]:[/\\]|file:)|\.(whl|tgz|tar\.gz|gem)$/;

/** The package names that the command adds, or an empty list. */
function packages(cmd) {
  const args = cmd.args;
  if (LOCKFILE_FLAGS.some((f) => args.includes(f))) return [];
  const names = (ops) => ops.filter((o) => !LOCAL_SPEC.test(o));
  switch (cmd.name) {
    case "npm":
    case "pnpm":
    case "yarn":
    case "bun": {
      let ops = operands(args, NODE_VALUE_FLAGS);
      // `yarn workspace web add x` is `yarn add x` in the workspace `web`.
      if (cmd.name === "yarn" && ops[0] === "workspace") ops = ops.slice(2);
      const [sub, ...rest] = ops;
      const adds =
        cmd.name === "yarn"
          ? sub === "add"
          : ["add", "install", "i"].includes(sub);
      return adds ? names(rest) : [];
    }
    case "pip":
    case "pip3": {
      const [sub, ...rest] = operands(args, PIP_VALUE_FLAGS);
      if (sub !== "install") return [];
      // An upgrade of `pip` itself adds no dependency.
      const upgrade = hasFlag(args, ["--upgrade"], "U");
      return names(rest).filter(
        (n) => !(upgrade && /^pip([<>=!~].*)?$/.test(n)),
      );
    }
    case "uv": {
      const [sub, ...rest] = operands(args, UV_VALUE_FLAGS);
      if (sub === "add") return names(rest);
      return sub === "pip" && rest[0] === "install" ? names(rest.slice(1)) : [];
    }
    case "poetry": {
      const [sub, ...rest] = operands(args, POETRY_VALUE_FLAGS);
      return sub === "add" ? names(rest) : [];
    }
    case "cargo": {
      const [sub, ...rest] = operands(args, CARGO_VALUE_FLAGS);
      return sub === "add" && !hasFlag(args, ["--path"]) ? names(rest) : [];
    }
    case "go": {
      const [sub, ...rest] = operands(args);
      return sub === "get" ? names(rest) : [];
    }
    case "gem": {
      const [sub, ...rest] = operands(args, GEM_VALUE_FLAGS);
      return sub === "install" ? names(rest) : [];
    }
    case "composer": {
      const [sub, ...rest] = operands(args, COMPOSER_VALUE_FLAGS);
      return sub === "require" ? names(rest) : [];
    }
    case "dotnet": {
      const ops = operands(args, DOTNET_VALUE_FLAGS);
      const at = ops.indexOf("package");
      return ops[0] === "add" && at > 0 ? names(ops.slice(at + 1, at + 2)) : [];
    }
    default:
      return [];
  }
}

export function dependency(cmd) {
  const found = packages(cmd);
  if (!found.length) return [];
  const list = found.map((p) => `\`${p}\``).join(", ");
  return [
    [
      "ask",
      `\`${cmd.name}\` adds a new dependency: ${list}. A model can name a package that does not exist, and an attacker can publish a package under such a name. Check that each package exists, that its name is spelled correctly, and that the project needs it`,
    ],
  ];
}

// --- TLS verification -------------------------------------------------------

// Short `curl` flags that take a value.
// The rest of the cluster is that value.
const CURL_VALUE_SHORT = "AbcCdDeEFHKmoPQrtTuUwxXyYz";

const LOOPBACK =
  /^([a-z][a-z0-9+.-]*:\/\/)?([^/@]*@)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])([:/?#]|$)/i;

const CURL_VALUE_FLAGS = new Set([
  ...[...CURL_VALUE_SHORT].map((c) => `-${c}`),
  "--header",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-urlencode",
  "--form",
  "--json",
  "--output",
  "--user",
  "--request",
  "--user-agent",
  "--referer",
  "--cookie",
  "--cookie-jar",
  "--max-time",
  "--write-out",
  "--proxy",
  "--upload-file",
  "--retry",
  "--connect-timeout",
  "--cacert",
  "--cert",
  "--key",
  "--resolve",
  "--config",
]);

/** A short-flag cluster that sets `-k` before a flag that takes a value. */
function curlInsecureCluster(arg) {
  if (!isFlagCluster(arg)) return false;
  for (const ch of arg.slice(1)) {
    if (ch === "k") return true;
    if (CURL_VALUE_SHORT.includes(ch)) return false;
  }
  return false;
}

/** Every URL operand is a loopback address. */
function loopbackOnly(args) {
  const urls = operands(args, CURL_VALUE_FLAGS);
  return urls.length > 0 && urls.every((u) => LOOPBACK.test(u));
}

const FALSE_VALUE = /^(false|0|no|off)$/i;

// Git turns verification off when `GIT_SSL_NO_VERIFY` has any value.
// The git documentation says so, and `http.c` tests only that the variable is set.
const TLS_ENV = {
  NODE_TLS_REJECT_UNAUTHORIZED: (v) => v === "0",
  GIT_SSL_NO_VERIFY: () => true,
  npm_config_strict_ssl: (v) => FALSE_VALUE.test(v),
  "npm_config_strict-ssl": (v) => FALSE_VALUE.test(v),
};

const DECLARE_NAMES = new Set(["export", "declare", "typeset"]);

/**
 * The TLS variables that the command sets, in a prefix assignment or in an
 * `export` or `declare -x` command.
 */
function tlsEnvOff(cmd) {
  const sets = { ...cmd.assigns };
  if (DECLARE_NAMES.has(cmd.name))
    for (const a of cmd.args) {
      const eq = a.indexOf("=");
      if (eq > 0) sets[a.slice(0, eq)] = a.slice(eq + 1);
    }
  return Object.entries(sets)
    .filter(([name, value]) =>
      TLS_ENV[name.replace(/^NPM_CONFIG_/, "npm_config_")]?.(
        String(value).trim(),
      ),
    )
    .map(([name]) => `the variable \`${name}\``);
}

function tlsFlagsOff(cmd) {
  const args = cmd.args;
  const found = [];
  switch (cmd.name) {
    case "curl":
      if (
        !loopbackOnly(args) &&
        args.some(
          (a) => a === "--insecure" || a === "-k" || curlInsecureCluster(a),
        )
      )
        found.push("`--insecure`");
      break;
    case "wget":
      if (args.includes("--no-check-certificate"))
        found.push("`--no-check-certificate`");
      break;
    case "git": {
      const { globals, sub, rest } = gitSplit(args);
      const sslKey = /^http\.([^=]*\.)?sslverify$/i;
      for (let i = 0; i < globals.length - 1; i += 1) {
        if (globals[i] !== "-c") continue;
        const eq = globals[i + 1].indexOf("=");
        if (
          eq > 0 &&
          sslKey.test(globals[i + 1].slice(0, eq)) &&
          FALSE_VALUE.test(globals[i + 1].slice(eq + 1))
        )
          found.push(`\`-c ${globals[i + 1]}\``);
      }
      if (sub === "config") {
        const pos = operands(rest);
        const at = pos.findIndex((a) => sslKey.test(a));
        if (at >= 0 && FALSE_VALUE.test(pos[at + 1] ?? ""))
          found.push(`\`config ${pos[at]} ${pos[at + 1]}\``);
      }
      break;
    }
    case "npm":
    case "pnpm": {
      const pos = operands(args);
      const strict = pos.findIndex((a) => /^strict-ssl(=|$)/.test(a));
      const value = pos[strict]?.split("=")[1] ?? pos[strict + 1] ?? "";
      if (
        (pos[0] === "config" &&
          pos[1] === "set" &&
          strict >= 0 &&
          FALSE_VALUE.test(value)) ||
        args.includes("--no-strict-ssl") ||
        args.includes("--strict-ssl=false")
      )
        found.push("`strict-ssl false`");
      break;
    }
    case "pip":
    case "pip3":
    case "uv":
      if (
        args.some(
          (a) =>
            a === "--trusted-host" ||
            a.startsWith("--trusted-host=") ||
            a === "--allow-insecure-host" ||
            a.startsWith("--allow-insecure-host="),
        )
      )
        found.push("`--trusted-host`");
      break;
    default:
  }
  return found;
}

function tlsFinding(cmd, found) {
  return found.length
    ? [
        [
          "ask",
          `\`${cmd.name}\` turns off TLS verification (${found.join(", ")}). Then an attacker on the network can read or change the data. Fix the certificate problem instead, or ask the user to approve the risk`,
        ],
      ]
    : [];
}

/** Turned-off verification by flag or setting. */
export function tls(cmd) {
  return tlsFinding(cmd, tlsFlagsOff(cmd));
}

/** Turned-off verification by an environment variable, for any command. */
export function tlsEnv(cmd) {
  return tlsFinding(cmd, tlsEnvOff(cmd));
}

// --- wrappers ---------------------------------------------------------------

const RUNNER_VALUE_FLAGS = new Set(["-p", "--package", "-c", "--call"]);

/**
 * The command that `npx`, `bunx`, `pnpx`, or `python -m pip` runs, as a
 * command of its own. Undefined for any other command.
 */
function inner(cmd) {
  if (["npx", "bunx", "pnpx"].includes(cmd.name)) {
    const [name, ...args] = operandsFrom(cmd.args, RUNNER_VALUE_FLAGS);
    return name ? { ...cmd, name, args } : undefined;
  }
  if (language(cmd.name) === "python") {
    const at = cmd.args.indexOf("-m");
    const mod = cmd.args[at + 1];
    return at >= 0 && (mod === "pip" || mod === "pip3")
      ? { ...cmd, name: "pip", args: cmd.args.slice(at + 2) }
      : undefined;
  }
  return undefined;
}

/** Like `operands`, but the arguments after the first operand stay. */
function operandsFrom(args, valueFlags) {
  for (let i = 0; i < args.length; i += 1) {
    if (valueFlags.has(args[i])) i += 1;
    else if (!args[i].startsWith("-")) return args.slice(i);
  }
  return [];
}

export async function wrapped(cmd, ctx) {
  const run = inner(cmd);
  if (!run) return [];
  return [
    ...(INFRA_NAMES.includes(run.name) ? await infra(run, ctx) : []),
    ...(run.name === "pip" ? dependency(run) : []),
    ...tls(run),
  ];
}

// --- test files -------------------------------------------------------------

const isTestPath = (p) => TEST_PATH.test(p) || TEST_PATH.test(`${p}/`);

/**
 * The sources and the destination of `mv`.
 * The destination comes from the last operand, or from `-t DIR`.
 */
function moveOperands(args) {
  const ops = [];
  let dir;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--") {
      ops.push(...args.slice(i + 1));
      break;
    }
    if (a === "-S" || a === "--suffix") i += 1;
    else if (a === "--target-directory") {
      i += 1;
      dir = args[i];
    } else if (a.startsWith("--target-directory=")) dir = a.slice(19);
    else if (isFlagCluster(a) && /^-[a-zA-Z]*t/.test(a)) {
      const rest = a.slice(a.indexOf("t") + 1);
      if (!rest) i += 1;
      dir = rest || args[i];
    } else if (!a.startsWith("-")) ops.push(a);
  }
  return dir === undefined
    ? { sources: ops.slice(0, -1), dest: ops.at(-1) }
    : { sources: ops, dest: dir };
}

/** The tracked test files that the command deletes or moves away. */
async function removedTests(cmd, ctx) {
  const { io } = ctx;
  const path = pathFor(io.platform);
  let list;
  if (cmd.name === "rm" || cmd.name === "shred") list = targets(cmd.args);
  else if (cmd.name === "mv") {
    const { sources, dest } = moveOperands(cmd.args);
    // A move to another test path is a rename.
    if (dest !== undefined && isTestPath(dest)) return [];
    list = sources;
  } else return [];
  const found = [];
  for (const t of list) {
    const p = resolveTarget(t, cmd, ctx);
    if (p === undefined) {
      // The path is only known at run time, so git cannot say if it tracks it.
      if (isTestPath(t)) found.push(t);
      continue;
    }
    const rel = path.relative(ctx.root, p).split(path.sep).join("/");
    if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
    if (!isTestPath(rel)) continue;
    if ((await git(io, ctx.root, ["ls-files", "--", p]))?.trim()) found.push(t);
  }
  return found;
}

function testReason(name, files) {
  const list = files.map((f) => `\`${f}\``).join(", ");
  if (name === "mv")
    return [
      "ask",
      `\`mv\` moves a test file out of the test paths: ${list}. The test can stop running. Keep it in a test path, or ask the user before you move it`,
      "test-delete",
    ];
  return [
    "ask",
    `\`${name}\` deletes a test file: ${list}. A deleted test can hide a failure. Fix the code or the test instead. Ask the user before you delete a test`,
    "test-delete",
  ];
}

export async function testDelete(cmd, ctx) {
  const files = await removedTests(cmd, ctx);
  return files.length ? [testReason(cmd.name, files)] : [];
}

export function gitTestDelete(cmd) {
  const { sub, rest } = gitSplit(cmd.args);
  // `git rm --cached` only stops tracking. The file stays on disk.
  if (sub !== "rm" || hasFlag(rest, ["--cached"])) return [];
  const files = targets(rest).filter(isTestPath);
  return files.length ? [testReason("git rm", files)] : [];
}

// --- table ------------------------------------------------------------------

const INFRA_NAMES = [
  "terraform",
  "tofu",
  "terragrunt",
  "pulumi",
  "cdk",
  "kubectl",
  "helm",
  "aws",
  "gcloud",
  "az",
  "fly",
  "flyctl",
];
const DEPENDENCY_NAMES = [
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "pip",
  "pip3",
  "uv",
  "poetry",
  "cargo",
  "go",
  "gem",
  "composer",
  "dotnet",
];

/** Handlers of the rules in this file, to merge into the Bash guard table. */
export const INFRA_HANDLERS = merge(
  Object.fromEntries(INFRA_NAMES.map((n) => [n, infra])),
  Object.fromEntries(DEPENDENCY_NAMES.map((n) => [n, dependency])),
  Object.fromEntries(
    ["curl", "wget", "git", ...DEPENDENCY_NAMES].map((n) => [n, tls]),
  ),
  Object.fromEntries(["npx", "bunx", "pnpx"].map((n) => [n, wrapped])),
  { rm: testDelete, shred: testDelete, mv: testDelete, git: gitTestDelete },
);
