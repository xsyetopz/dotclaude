// Images from a local ComfyUI server.
// A port of `um/comfy.py` from universal-modder.
// `data/comfy.json` has the help, the messages, the default graph, and its defaults.

import fs from "node:fs";
import path from "node:path";
import {
  die,
  emit,
  isWindows,
  num,
  parseSize,
  run,
  SPRITE_STYLE,
  slug,
} from "./common.mjs";
import DATA from "./data/comfy.json" with { type: "json" };

export const help = DATA.help.join("\n");

/** Dies with the message `key` of the data file, with each {name} filled from `v`. */
const fail = (key, v) =>
  die(DATA.messages[key].replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "?"));

export const baseUrl = (url) =>
  (url || process.env.COMFYUI_URL || DATA.url).replace(/\/+$/, "");

const isObject = (x) => x && typeof x === "object" && !Array.isArray(x);

/** The validation error of ComfyUI as one readable line for each problem. */
function describe({ error: e, node_errors: nodes = {}, ...rest }) {
  const lines = [
    typeof e === "object" ? [e?.message, e?.details].join(" ") : e,
    ...Object.entries(nodes).flatMap(([id, n]) =>
      (n.errors || []).map((x) =>
        `node ${id} (${n.class_type ?? "?"}): ${x.message}: ${x.details}`.replace(
          /[: ]+$/,
          "",
        ),
      ),
    ),
  ];
  return (
    lines.filter((l) => l?.trim()).join("\n  ") ||
    JSON.stringify({ error: e, ...rest }).slice(0, 1500)
  );
}

/** A request to ComfyUI. It returns JSON, bytes with `raw`, or null for a 404 with `missingOk`. */
async function req(base, route, { body, raw, timeout = 60, missingOk } = {}) {
  let res;
  try {
    res = await fetch(base + route, {
      method: body ? "POST" : "GET",
      headers: body && { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout * 1000),
    });
  } catch (e) {
    fail("noServer", { base, err: e.message });
  }
  if (res.ok)
    return raw
      ? new Uint8Array(await res.arrayBuffer())
      : ((await res.json().catch(() => ({}))) ?? {});
  if (missingOk && res.status === 404) return null;
  const text = await res.text();
  let err;
  try {
    err = JSON.parse(text);
  } catch {}
  if (route === "/prompt" && (err?.error || err?.node_errors))
    fail("rejected", { detail: describe(err) });
  fail("http", {
    route: route.split("?")[0],
    status: res.status,
    detail: text.slice(0, 1500),
  });
}

export async function checkpoints(base) {
  const names = await req(base, "/models/checkpoints", { missingOk: true }); // older servers have no /models route
  if (Array.isArray(names)) return names.map(String);
  // /object_info lists the options as [[a, b], {...}] (classic) or ["COMBO", {"options": [a, b]}] (v3).
  const info = await req(base, "/object_info/CheckpointLoaderSimple");
  const [a, b] = info.CheckpointLoaderSimple?.input?.required?.ckpt_name ?? [];
  return (Array.isArray(a) ? a : b?.options || []).map(String);
}

export async function status(base) {
  const { system = {}, devices = [] } = await req(base, "/system_stats");
  return {
    url: base,
    version: system.comfyui_version,
    pytorch: system.pytorch_version,
    devices: devices.map((d) => `${d.name} (${d.type})`),
    checkpoints: await checkpoints(base),
  };
}

/** The default graph of ComfyUI in API format (the same node ids as the stock workflow). */
export function txt2img(prompt, checkpoint, o = {}) {
  const vals = { ...DATA.defaults, prompt, checkpoint };
  for (const [k, v] of Object.entries(o)) if (v !== undefined) vals[k] = v;
  return JSON.parse(
    JSON.stringify(DATA.txt2img, (_k, v) =>
      typeof v === "string" && v.startsWith("$") ? vals[v.slice(1)] : v,
    ),
  );
}

export function loadWorkflow(file) {
  let wf;
  try {
    wf = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    fail(e.code === "ENOENT" ? "noFile" : "notJson", { file, err: e.message });
  }
  if (isObject(wf) && "nodes" in wf && "links" in wf)
    fail("uiFormat", { file });
  if (isObject(wf?.prompt)) wf = wf.prompt;
  const nodes = Object.values(isObject(wf) ? wf : {});
  if (!nodes.length || !nodes.every((v) => isObject(v) && "class_type" in v))
    fail("notApi", { file });
  return wf;
}

/** NODE.INPUT=value (a string) or NODE.INPUT:=json, with NODE a node id or title. Returns a changed copy. */
export function applySet(workflow, sets = []) {
  const wf = structuredClone(workflow);
  for (const s of sets) {
    const [, ref, input, json, text] =
      /^([^=]+)\.([^.=]+?)(:?)=(.*)$/s.exec(s) ?? fail("badSet", { s });
    const ids = Object.keys(wf);
    const hits = ids.includes(ref)
      ? [ref]
      : ids.filter(
          (k) => `${wf[k]._meta?.title}`.toLowerCase() === ref.toLowerCase(),
        );
    if (hits.length !== 1)
      fail("badNode", {
        what: hits.length ? "several nodes are" : "no node is",
        ref,
        nodes: ids
          .map((k) => `${k} (${wf[k]._meta?.title || wf[k].class_type})`)
          .join(", "),
      });
    let val = text;
    if (json)
      try {
        val = JSON.parse(text);
      } catch {
        fail("badJson", { s, text });
      }
    const node = wf[hits[0]];
    node.inputs = { ...node.inputs, [input]: val };
  }
  return wf;
}

export async function queue(base, wf) {
  const res = await req(base, "/prompt", {
    body: { prompt: wf, client_id: crypto.randomUUID().replaceAll("-", "") },
  });
  if (Object.keys(res.node_errors || {}).length)
    fail("rejected", { detail: describe(res) });
  return (
    res.prompt_id ??
    fail("notQueued", { detail: JSON.stringify(res).slice(0, 1500) })
  );
}

async function wait(base, id, timeout, poll) {
  for (const end = Date.now() + timeout * 1000; Date.now() < end; ) {
    const h = (await req(base, `/history/${id}`))[id];
    const st = h?.status || {};
    if (st.status_str === "error") {
      const e = st.messages?.find(([kind]) => kind === "execution_error")?.[1];
      fail("failed", {
        node: e?.node_id,
        type: e?.node_type,
        text: e?.exception_message ?? "see the ComfyUI console",
      });
    }
    if (h && (st.completed ?? true)) return h;
    await Bun.sleep(poll * 1000);
  }
  fail("timeout", { s: Math.round(timeout), id });
}

/** Queues a workflow, waits, downloads each output file ({filename, subfolder, type}) into `out`, and adds a manifest line. Returns the paths. */
export async function generate(
  base,
  wf,
  out,
  name,
  { timeout = 1800, record = {}, poll = 1 } = {},
) {
  fs.mkdirSync(out, { recursive: true });
  const id = await queue(base, wf);
  const { outputs = {} } = await wait(base, id, timeout, poll);
  const made = Object.keys(outputs)
    .sort((a, b) => a.length - b.length || (a < b ? -1 : 1))
    .flatMap((n) => Object.values(outputs[n]).filter(Array.isArray).flat())
    .filter((x) => isObject(x) && x.filename);
  const files = [];
  for (const [i, f] of made.entries()) {
    const q = new URLSearchParams({
      filename: f.filename,
      subfolder: f.subfolder ?? "",
      type: f.type ?? "output",
    });
    const ext = path.extname(f.filename) || ".png";
    const file = path.join(out, `${i ? `${name}_${i + 1}` : name}${ext}`);
    const data = await req(base, `/view?${q}`, { raw: true, timeout: 600 });
    await Bun.write(file, data);
    files.push(file);
  }
  if (!files.length) fail("nothing", { id });
  const t = new Date().toLocaleString("sv").replace(" ", "T");
  const rec = {
    t,
    url: base,
    prompt_id: id,
    name,
    files,
    ...record,
    workflow: wf,
  };
  fs.appendFileSync(
    path.join(out, "comfy_manifest.jsonl"),
    `${JSON.stringify(rec)}\n`,
  );
  for (const f of files) console.log(f);
  return files;
}

export const commands = {
  status: {
    ...DATA.commands.status,
    async run(v) {
      const s = await status(baseUrl(v.url));
      if (v.json) return emit(s, true);
      console.log(
        [
          `ComfyUI ${s.version || "?"} at ${s.url} (PyTorch ${s.pytorch || "?"})`,
          ...s.devices.map((d) => `  device: ${d}`),
          `  ${s.checkpoints.length} checkpoint(s)`,
          ...s.checkpoints.map((c) => `    ${c}`),
        ].join("\n"),
      );
    },
  },
  image: {
    ...DATA.commands.image,
    async run(v, [prompt, ...extra]) {
      if (!prompt || extra.length) die("expected: <prompt>");
      const base = baseUrl(v.url);
      const ckpt = v.checkpoint || (await checkpoints(base))[0];
      if (!ckpt) fail("noCheckpoints");
      const [width, height] = v.size
        ? parseSize(v.size)
        : /xl|1024/i.test(ckpt)
          ? [1024, 1024]
          : [512, 512];
      const text = v.sprite
        ? `${prompt}. ${SPRITE_STYLE}, on a plain flat white background`
        : prompt;
      const seed = num(v.seed, Math.floor(Math.random() * 2 ** 32));
      const wf = txt2img(text, ckpt, {
        ...v,
        width,
        height,
        seed,
        steps: num(v.steps),
        cfg: num(v.cfg),
        n: num(v.n),
      });
      const name = v.name || slug(prompt, "image");
      const files = await generate(base, wf, v.out, name, {
        timeout: num(v.timeout, 1800),
        record: { prompt: text, checkpoint: ckpt, seed },
      });
      // Bun modules do not read or write pixels, so `um sprite` cuts the background out.
      const um = path.join(
        import.meta.dir,
        "../bin",
        isWindows() ? "um.cmd" : "um",
      );
      for (const f of v.sprite ? files : []) {
        const cut = path.join(path.dirname(f), `${path.parse(f).name}_cut.png`);
        run([um, "sprite", "cutout", f, cut]);
        console.log(cut);
      }
    },
  },
  run: {
    ...DATA.commands.run,
    async run(v, [workflow, ...extra]) {
      if (!workflow || extra.length) die("expected: <workflow>");
      const wf = applySet(loadWorkflow(workflow), v.set);
      const name = v.name || path.parse(workflow).name;
      await generate(baseUrl(v.url), wf, v.out, name, {
        timeout: num(v.timeout, 1800),
        record: { source: workflow, set: v.set || [] },
      });
    },
  },
};
