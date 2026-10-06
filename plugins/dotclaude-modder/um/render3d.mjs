// `um render3d`: render a GLB into sprite frames from the camera of a game, with Blender.
// It only runs Blender with `blender/render_sprites.py`, so it reads and writes no pixels.
// A port of `um/render3d.py` from universal-modder.
// `data/render3d.json` has the help text, the presets, the motions and the messages.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { die, parseSize, run } from "./common.mjs";
import data from "./data/render3d.json" with { type: "json" };

const M = data.messages;
export const help = data.help.join("\n");
export const PRESETS = data.presets;
export const MOTIONS = data.motions;

export function blenderBin() {
  const set = process.env.BLENDER;
  if (set && !fs.existsSync(set) && !Bun.which(set)) die(M.notProgram + set);
  return (
    set ||
    Bun.which("blender") ||
    data.blenderPaths.find((p) => fs.existsSync(p)) ||
    die(M.notFound)
  );
}

/** 'idle:10:bob,walk:12:walk' -> { idle: { frames, motion }, ... } */
export function parseAnims(spec) {
  return Object.fromEntries(
    spec.split(",").map((part) => {
      const [name, frames = "1", motion] = part.split(":");
      const key = pick({ motion }, "motion", "still", Object.keys(MOTIONS));
      const n = Number(frames);
      if (!Number.isInteger(n) || n < 1) die(`not a frame count: ${frames}`);
      return [name, { frames: n, motion: MOTIONS[key] }];
    }),
  );
}

const num = (name, value) =>
  Number.isFinite(Number(value))
    ? Number(value)
    : die(`--${name} needs a number: ${value}`);

/** Checks that `o[name]` (or `dflt`) is one of `list`. */
const pick = (o, name, dflt, list, sep = ", ") =>
  list.includes(o[name] ?? dflt)
    ? (o[name] ?? dflt)
    : die(`unknown ${name}: ${o[name]} (use ${list.join(sep)})`);

export function render(glb, outDir, o = {}) {
  const preset = pick(o, "preset", "aoe2", Object.keys(PRESETS));
  const engine = pick(o, "engine", "cycles", ["cycles", "eevee"], " or ");
  const measure = pick(o, "measure", "length", ["length", "height"], " or ");
  if (!fs.existsSync(glb)) die(`not found: ${glb}`);
  const out = path.resolve(outDir);
  const n = (name, dflt) => num(name, o[name] ?? dflt);
  const camera = { ...PRESETS[preset] };
  if (o.elevation !== undefined) camera.elevation_deg = n("elevation");
  if (o.headings !== undefined) camera.headings = n("headings");
  const [w, h] = parseSize(o.canvas ?? "200");
  const [samples, shadows] = [n("samples", 40), Boolean(o.shadows)];
  const anims = parseAnims(o.anims ?? "idle:1");
  const cfg = {
    glb: path.resolve(glb),
    out_dir: out,
    canvas: [w, h],
    length_px: n("length", 80),
    forward_yaw_deg: n("forward-yaw", 0),
    camera,
    anims,
    shadows,
    samples,
    engine: engine.toUpperCase(),
    light: { sun: n("sun", 4.0), ambient: n("ambient", 0.9) },
    measure,
  };
  // The side view stands on the bottom of the frame.
  const groundY = o["ground-y"] ?? (preset === "side" ? h * 0.92 : undefined);
  if (groundY !== undefined) cfg.ground_y = num("ground-y", groundY);

  const blender = blenderBin();
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "um-render3d-"));
  const cfgPath = path.join(tmp, "config.json");
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  const frames = Object.values(anims).reduce((s, a) => s + a.frames, 0);
  const count = frames * camera.headings * (shadows ? 2 : 1);
  console.log(
    `rendering ${count} images with Blender (${engine}, ${samples} samples) -> ${out}`,
  );
  try {
    const script = path.join(import.meta.dir, "blender", "render_sprites.py");
    const r = run([blender, "-b", "--python", script, "--", cfgPath], {
      check: false,
    });
    const done = r.stdout
      .split("\n")
      .findLast((l) => l.startsWith("UM_RENDER_DONE"));
    if (r.status !== 0 || !done)
      die(`Blender failed:\n${(r.stderr || r.stdout).slice(-3000)}`);
    console.log(done.replace("UM_RENDER_DONE", "rendered"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export const commands = {
  default: {
    help,
    usage: data.usage,
    options: data.options,
    run(values, [glb, out]) {
      if (!glb || !out) die(M.usage, 2);
      render(glb, out, values);
    },
  },
};
