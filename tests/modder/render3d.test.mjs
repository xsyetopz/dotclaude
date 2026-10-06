// The parts of `um render3d` that run without Blender.

import { expect, test } from "bun:test";
import {
  commands,
  parseAnims,
  render,
} from "../../plugins/dotclaude-modder/um/render3d.mjs";

const glb = import.meta.path;

test("parseAnims maps name:frames:motion", () => {
  const a = parseAnims("idle:10:bob,hold");
  expect(a.idle.frames).toBe(10);
  expect(a.idle.motion.kind).toBe("bob");
  expect(a.hold).toEqual({ frames: 1, motion: null });
});

test("parseAnims rejects an unknown motion", () => {
  expect(() => parseAnims("idle:2:fly")).toThrow("unknown motion");
});

test("render rejects an unknown preset", () => {
  expect(() => render(glb, "/tmp/x", { preset: "nope" })).toThrow(
    "unknown preset",
  );
});

test("render names a BLENDER path that does not exist", () => {
  const old = process.env.BLENDER;
  process.env.BLENDER = "/nonexistent/blender";
  try {
    expect(() => render(glb, "/tmp/um-render3d-unused", {})).toThrow(
      "BLENDER is not a program",
    );
  } finally {
    if (old === undefined) delete process.env.BLENDER;
    else process.env.BLENDER = old;
  }
});

test("the render command needs a model and an output folder", () => {
  expect(() => commands.default.run({}, [])).toThrow("usage");
});
