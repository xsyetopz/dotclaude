import { afterAll, beforeAll, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {
  applySet,
  checkpoints,
  commands,
  generate,
  loadWorkflow,
  queue,
  status,
  txt2img,
} from "../../plugins/dotclaude-modder/um/comfy.mjs";
import { UmError } from "../../plugins/dotclaude-modder/um/common.mjs";

const root = path.join(
  import.meta.dir,
  "..",
  "..",
  "plugins",
  "dotclaude-modder",
);
const canSprite =
  fs.existsSync(path.join(root, "um", "py", "sprite.py")) && Bun.which("uv");

/** A 16x16 PNG: a red square (4..12) on a white background. */
function png() {
  const raw = Buffer.alloc(16 * (1 + 16 * 4), 255);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (x < 4 || x >= 12 || y < 4 || y >= 12) continue;
      raw.set([200, 30, 30, 255], y * 65 + 1 + x * 4);
      raw[y * 65] = 0;
    }
  for (let y = 0; y < 16; y++) raw[y * 65] = 0;
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length);
    head.write(type, 4);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(Bun.hash.crc32(Buffer.concat([head.subarray(4), data])));
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(16, 0);
  ihdr.writeUInt32BE(16, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// A stand-in for the HTTP API of ComfyUI: /system_stats, /models, /object_info, /prompt, /history, /view.
const state = { prompts: [], polls: 0, modelsRoute: true };
let server;
let url;
let tmp;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "um-comfy-"));
  const image = png();
  const json = (body, status = 200) => Response.json(body, { status });
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      if (req.method === "POST") {
        const wf = (await req.json()).prompt;
        state.prompts.push(wf);
        if (wf[4]?.inputs?.ckpt_name === "missing.safetensors")
          return json(
            {
              error: {
                message: "Prompt outputs failed validation",
                details: "",
              },
              node_errors: {
                4: {
                  class_type: "CheckpointLoaderSimple",
                  errors: [
                    {
                      message: "Value not in list",
                      details: "ckpt_name: 'missing.safetensors' not in [...]",
                    },
                  ],
                },
              },
            },
            400,
          );
        return json({ prompt_id: "p1", number: 0, node_errors: {} });
      }
      switch (u.pathname) {
        case "/system_stats":
          return json({
            system: { comfyui_version: "0.9.0", pytorch_version: "2.9.0" },
            devices: [{ name: "fake", type: "cpu" }],
          });
        case "/models/checkpoints":
          return state.modelsRoute
            ? json(["sd15.safetensors", "sdxl_base.safetensors"])
            : new Response("404: Not Found", { status: 404 });
        case "/object_info/CheckpointLoaderSimple":
          return json({
            CheckpointLoaderSimple: {
              input: {
                required: {
                  ckpt_name: ["COMBO", { options: ["v3.safetensors"] }],
                },
              },
            },
          });
        case "/history/p1":
          state.polls++; // the first poll finds it still running
          return json(
            state.polls > 1
              ? {
                  p1: {
                    status: { status_str: "success", completed: true },
                    outputs: {
                      9: {
                        images: [
                          {
                            filename: "um_00001_.png",
                            subfolder: "",
                            type: "output",
                          },
                        ],
                      },
                    },
                  },
                }
              : {},
          );
        case "/view":
          return u.searchParams.get("filename") === "um_00001_.png"
            ? new Response(image, { headers: { "Content-Type": "image/png" } })
            : new Response("404: Not Found", { status: 404 });
        default:
          return new Response("404: Not Found", { status: 404 });
      }
    },
  });
  url = `http://127.0.0.1:${server.port}`;
});
afterAll(() => {
  server.stop(true);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("image --sprite uses the first checkpoint, the seed, and a cut-out step", async () => {
  const out = path.join(tmp, "gen");
  state.polls = 0;
  const run = () =>
    commands.image.run(
      {
        url,
        out,
        seed: "7",
        sprite: true,
        sampler: "euler",
        scheduler: "normal",
      },
      ["a red potion"],
    );
  if (canSprite) await run();
  else {
    // `um sprite` is not there or `uv` is missing, so only the cut-out step fails
    await expect(run()).rejects.toBeInstanceOf(UmError);
  }
  const wf = state.prompts.at(-1);
  expect(wf[4].inputs.ckpt_name).toBe("sd15.safetensors"); // the first checkpoint listed
  expect([wf[5].inputs.width, wf[3].inputs.seed]).toEqual([512, 7]); // SD 1.5 size, the given seed
  expect(wf[6].inputs.text).toContain("plain flat white background");
  expect(fs.existsSync(path.join(out, "a_red_potion.png"))).toBe(true);
  const rec = JSON.parse(
    fs
      .readFileSync(path.join(out, "comfy_manifest.jsonl"), "utf8")
      .trim()
      .split("\n")
      .at(-1),
  );
  expect(rec.prompt_id).toBe("p1");
  expect(rec.seed).toBe(7);
  expect(rec.workflow[9].class_type).toBe("SaveImage");
  if (canSprite)
    expect(fs.existsSync(path.join(out, "a_red_potion_cut.png"))).toBe(true);
}, 60_000);

test("run applies --set, and errors are readable", async () => {
  state.polls = 0;
  const base = txt2img("x", "sd15.safetensors");
  base[6]._meta = { title: "Positive" };
  const file = path.join(tmp, "wf.json");
  fs.writeFileSync(file, JSON.stringify(base));
  const wf = applySet(loadWorkflow(file), [
    "Positive.text=a v1.5 sword=sharp",
    "3.seed:=42",
  ]);
  expect([wf[6].inputs.text, wf[3].inputs.seed]).toEqual([
    "a v1.5 sword=sharp",
    42,
  ]);
  const files = await generate(url, wf, path.join(tmp, "o"), "sword", {
    poll: 0,
  });
  expect(files.map((f) => path.basename(f))).toEqual(["sword.png"]);

  const ui = path.join(tmp, "ui.json");
  fs.writeFileSync(ui, JSON.stringify({ nodes: [], links: [] }));
  expect(() => loadWorkflow(ui)).toThrow(/Export \(API\)/); // UI format: needs Export (API)
  const rejected = queue(url, txt2img("x", "missing.safetensors"));
  await expect(rejected).rejects.toThrow(/Value not in list/); // validation error reported

  state.modelsRoute = false;
  expect(await checkpoints(url)).toEqual(["v3.safetensors"]); // older servers: /object_info
  expect((await status(url)).version).toBe("0.9.0");
  state.modelsRoute = true;
});
