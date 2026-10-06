// `um`: one entry point for each tool, so that the skills can say `um <group> <command>`.
// Each group module exports `help` and `commands`,
// where a command is `{ help, usage, options, run(values, positionals) }`
// and `options` is a `node:util` parseArgs options object.
// The groups in `PY_GROUPS` are Python scripts in `py/`, because Pillow and numpy do their pixel work.
// `uv` installs their PEP 723 dependencies, and without `uv` the system Python runs them.

import path from "node:path";
import { parseArgs } from "node:util";
import pkg from "../.claude-plugin/plugin.json" with { type: "json" };
import { isWindows, UmError } from "./common.mjs";

const PY_GROUPS = new Set(["sprite", "video", "backup"]);

const GROUPS = {
  scan: "find installed games and fingerprint one: engine, runtime, anti-cheat, mod loaders, routes",
  fal: "generate game assets with fal (sprites, textures, PBR, 3D, rigs, SFX, music, voice, video)",
  comfy: "generate images locally with ComfyUI (no API key)",
  sprite: "cut out, fit, pixelate, recolor and pack 2D sprites",
  render3d: "render a GLB into sprite frames from a game's camera (Blender)",
  video: "compile styled showcase videos, trim, mux",
  win: "Windows (and WSL): screenshots, recording with game-only audio, input, processes",
  backup: "snapshot and restore save folders before you touch them",
  publish:
    "lint a mod folder before sharing: game files, decompiled code, secrets, credits",
  kb: "the knowledge base: search prior field notes, write your own, check it, open a PR",
};

const usage = () =>
  `usage: um <group> <command> [options]\n\n${Object.entries(GROUPS)
    .map(([g, h]) => `  ${g.padEnd(9)} ${h}`)
    .join("\n")}\n\nEach group has --help.`;

function groupHelp(name, mod) {
  const cmds = Object.entries(mod.commands)
    .map(([c, { help }]) => `  ${c.padEnd(12)} ${help}`)
    .join("\n");
  return `usage: um ${name} <command> [options]\n\n${mod.help.trim()}\n\ncommands:\n${cmds}`;
}

function commandHelp(group, name, cmd) {
  const opts = Object.entries(cmd.options ?? {})
    .map(([o, { type, short, help = "" }]) =>
      `  ${short ? `-${short}, ` : ""}--${o}${type === "string" ? " VALUE" : ""}`
        .padEnd(help && 24)
        .concat(help && ` ${help}`),
    )
    .join("\n");
  const line = ["um", group, name, cmd.usage].filter(Boolean).join(" ");
  return `usage: ${line}\n\n${cmd.help.trim()}${opts ? `\n\noptions:\n${opts}` : ""}`;
}

async function runPython(group, args) {
  const script = path.join(import.meta.dir, "py", `${group}.py`);
  const python = isWindows() ? "python" : "python3";
  const cmd =
    Bun.which("uv") && !process.env.UM_NO_UV
      ? ["uv", "run", "--quiet", "--script", script, ...args]
      : [python, script, ...args];
  if (!Bun.which(cmd[0]))
    throw new UmError(
      `um ${group} needs uv or ${python}: https://docs.astral.sh/uv/`,
    );
  return Bun.spawn(cmd, { stdio: ["inherit", "inherit", "inherit"] }).exited;
}

export async function main(argv) {
  const [group, name, ...rest] = argv;
  if (group === "--version")
    return console.log(`dotclaude-modder ${pkg.version}`);
  if (!group || group === "-h" || group === "--help") {
    console.log(usage());
    return group ? 0 : 1;
  }
  if (!(group in GROUPS))
    throw new UmError(`unknown group: ${group}\n${usage()}`, 2);
  if (PY_GROUPS.has(group)) return runPython(group, argv.slice(1));
  const mod = await import(`./${group}.mjs`);
  let [cmd, args, cmdName] = [
    Object.hasOwn(mod.commands, name) && mod.commands[name],
    rest,
    name,
  ];
  // A group with a `default` command keeps the upstream form `um <group> <args>`, such as `um scan <game>`.
  if (!cmd && mod.commands.default)
    [cmd, args, cmdName] = [mod.commands.default, argv.slice(1), ""];
  if (!cmd) {
    console.log(groupHelp(group, mod));
    return name === "-h" || name === "--help" ? 0 : 1;
  }
  // After `--`, a `-h` is for the game or the tool that `um` starts.
  const own = args.includes("--") ? args.slice(0, args.indexOf("--")) : args;
  if (own.includes("-h") || own.includes("--help")) {
    console.log(commandHelp(group, cmdName, cmd));
    return 0;
  }
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: cmd.options ?? {},
      allowPositionals: true,
    });
  } catch (e) {
    throw new UmError(`${e.message}\n${commandHelp(group, cmdName, cmd)}`, 2);
  }
  // `run` can return an exit code, to fail without a message.
  return (await cmd.run(parsed.values, parsed.positionals)) ?? 0;
}
