// Game assets from fal (https://fal.ai) over plain REST.
// A port of `um/fal.py` from universal-modder.

import fs from "node:fs";
import path from "node:path";
import { die, emit, num, SPRITE_STYLE, slug } from "./common.mjs";
import DATA from "./data/fal.json" with { type: "json" };

export const help = `
Game assets from fal (https://fal.ai). This group uses plain REST and needs no SDK.
It needs a fal key: set the plugin option \`fal_key\` or the \`FAL_KEY\` environment variable.

    um fal sprite "a rusty scrap drone enemy, side view facing left, 16-bit pixel art" --out assets/gen --name drone
    um fal image "key art: ..." --aspect 16:9
    um fal edit "same drone, rotors blurred, second animation frame" --ref assets/gen/drone.png
    um fal rmbg in.png                       # background removal (BiRefNet v2)
    um fal pixelate in.png --colors 24       # image to clean pixel art (grid-snapped, palette-limited)
    um fal texture "mossy cobblestone"       # seamless tiling texture
    um fal pbr "rusted sheet metal"          # basecolor, normal, roughness, metalness, and height maps
    um fal model3d concept.png               # image to textured GLB (Trellis 2, or --engine hunyuan|tripo|meshy)
    um fal rig character.glb --animate       # auto-rig a humanoid (Meshy) to rigged GLB/FBX with animations
    um fal sfx "laser rifle shot, sci-fi, punchy" --seconds 1.5
    um fal music "tense boss battle, chiptune, 140 bpm" --seconds 60
    um fal voice "You dare challenge the Mothership?" --voice-id Adam
    um fal video still.png "camera orbits the boss as it powers up"
    um fal run <endpoint> key=value key:=json image_url=@local.png   # any other endpoint
    um fal search "image to 3d" | um fal schema fal-ai/trellis-2 | um fal price fal-ai/trellis-2

Each call adds a line to <out>/fal_manifest.jsonl (endpoint, inputs, request id, seed, files).
With this line, you can trace an asset and make it again.
A local file that you pass as an input goes to fal storage first.
Model ids change fast. \`um fal search\` and the search_models tool of the fal MCP find the current best.
`;

const QUEUE = "https://queue.fal.run";
export const CDN = "https://v3.fal.media";
const PLATFORM = "https://api.fal.ai/v1";
const RETRY = new Set([429, 500, 502, 503, 504]);
const isFile = (f) => fs.statSync(f, { throwIfNoEntry: false })?.isFile();
const query = (o) => new URLSearchParams(o);

/** A JSON request to fal. It retries a network error and the status codes in `RETRY` three times. */
async function req(method, url, { body, headers, auth = true } = {}) {
  const key = process.env.CLAUDE_PLUGIN_OPTION_FAL_KEY || process.env.FAL_KEY;
  if (auth && !key)
    die(
      "no fal key. Create a key at https://fal.ai/dashboard/keys, then set the plugin option `fal_key` or `FAL_KEY`",
    );
  const h = { Accept: "application/json", ...headers };
  if (auth) h.Authorization = `Key ${key}`;
  if (body !== undefined) h["Content-Type"] ??= "application/json";
  for (let attempt = 0; ; attempt++) {
    let res;
    let text;
    let err;
    try {
      res = await fetch(url, {
        method,
        headers: h,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      text = await res.text();
    } catch (e) {
      err = e.message;
    }
    if (res?.ok) return text ? JSON.parse(text) : {};
    if (attempt < 3 && (err || RETRY.has(res.status)))
      await Bun.sleep(2000 * (attempt + 1));
    else
      die(
        err
          ? `fal ${method} ${url}: ${err}`
          : `fal ${method} ${url.split("?")[0]} -> HTTP ${res.status}: ${text.slice(0, 1500)}`,
      );
  }
}

/** A local file to a URL that fal models can read (the CDN of fal). A small file falls back to a data URI. */
export async function upload(file) {
  if (!isFile(file)) die(`no such file: ${file}`);
  const name = path.basename(file);
  const ctype = file.toLowerCase().endsWith(".glb")
    ? "model/gltf-binary"
    : Bun.file(file).type.split(";")[0];
  const data = fs.readFileSync(file);
  let err;
  try {
    const tok = await req(
      "POST",
      "https://rest.fal.ai/storage/auth/token?storage_type=fal-cdn-v3",
      { body: {} },
    );
    const res = await fetch(`${CDN}/files/upload`, {
      method: "POST",
      body: data,
      headers: {
        Authorization: `${tok.token_type} ${tok.token}`,
        "Content-Type": ctype,
        "X-Fal-File-Name": name,
        Accept: "application/json",
        "User-Agent": "universal-modder",
      },
      signal: AbortSignal.timeout(600_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).access_url;
  } catch (e) {
    err = e.message;
  }
  if (data.length >= 8 << 20)
    die(
      `could not upload ${name} (${data.length.toLocaleString("en-US")} bytes) to fal storage (${err}). The data-URI fallback covers only files under 8 MiB`,
    );
  console.error(
    `fal upload failed (${err}), so ${name} goes inline as a data URI`,
  );
  return `data:${ctype};base64,${data.toString("base64")}`;
}

/** '@path' or an existing local path to an uploaded URL. A URL passes through. */
const asUrl = async (v) =>
  typeof v !== "string"
    ? v
    : v.startsWith("@")
      ? upload(v.slice(1))
      : !/^(https?|data):/.test(v) && isFile(v)
        ? upload(v)
        : v;

/** Yields `[json_path, url, content_type]` for each downloadable file in a result. */
export function* urlsIn(obj, trail = "") {
  if (!obj || typeof obj !== "object") return;
  const list = Array.isArray(obj);
  if (typeof obj.url === "string" && obj.url.startsWith("http"))
    yield [trail, obj.url, obj.content_type || ""];
  for (const [k, v] of Object.entries(obj))
    if (list || k !== "url")
      yield* urlsIn(v, list ? `${trail}[${k}]` : trail ? `${trail}.${k}` : k);
}

export async function downloadOutputs(result, out, name) {
  fs.mkdirSync(out, { recursive: true });
  const [files, failed, used] = [[], [], new Set()];
  let firstKey;
  for (const [trail, url, ctype] of urlsIn(result)) {
    const ext =
      path.extname(new URL(url).pathname) ||
      DATA.ext[ctype.split(";")[0]] ||
      "";
    const key =
      trail
        .replace(/\[\d+\]/g, "")
        .split(".")
        .pop() || "file";
    // images[0] gives name, images[1] gives name_2.
    // Other outputs (mask, thumbnail, fbx) give name_<key>.
    const n = Number([...trail.matchAll(/\d+(?=\])/g)].at(-1)?.[0] ?? 0) + 1;
    firstKey ??= key;
    const stem = `${name}${key === firstKey ? "" : `_${key}`}${n > 1 ? `_${n}` : ""}`;
    let file = path.join(out, `${stem}${ext}`);
    for (let i = 1; used.has(path.basename(file)); )
      file = path.join(out, `${stem}_${++i}${ext}`);
    used.add(path.basename(file));
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "universal-modder" },
        signal: AbortSignal.timeout(600_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await Bun.write(file, res);
      files.push(file);
    } catch (e) {
      failed.push(`${url} (${e.message})`); // keep going, because the other outputs are still worth saving
    }
  }
  if (failed.length) {
    const { _request_id: rid, _endpoint: ep = "<endpoint>" } = result;
    die(
      `the job finished but these outputs did not download:\n  ${failed.join("\n  ")}${
        rid
          ? `\nrequest ${rid}: try again later with \`um fal result ${ep} ${rid}\``
          : ""
      }`,
    );
  }
  return files;
}

/** Submits to the queue, polls (it prints the logs to stderr), and returns the result JSON. */
async function runJob(endpoint, inp, timeout = 1800) {
  const job = await req("POST", `${QUEUE}/${endpoint}`, { body: inp });
  const rid = job.request_id;
  const base = `${QUEUE}/${endpoint}/requests/${rid}`;
  const statusUrl = job.status_url || `${base}/status`;
  const log = (m) => console.error(`  [${endpoint}] ${m}`);
  const t0 = Date.now();
  let seen = 0;
  let last;
  for (;;) {
    const st = await req(
      "GET",
      `${statusUrl}${statusUrl.includes("?") ? "&" : "?"}logs=1`,
    );
    for (const line of (st.logs || []).slice(seen))
      if (line?.message) log(line.message);
    seen = st.logs?.length ?? 0;
    if (st.status !== last)
      log(
        `${st.status}${st.status === "IN_QUEUE" && st.queue_position != null ? ` (queue position ${st.queue_position})` : ""}`,
      );
    last = st.status;
    if (last === "COMPLETED") {
      if (st.error) die(`${endpoint} failed: ${st.error}`);
      const res = await req("GET", job.response_url || base);
      return { ...res, _request_id: rid, _endpoint: endpoint };
    }
    const age = (Date.now() - t0) / 1000;
    if (age > timeout)
      die(
        `${endpoint}: still ${last} after ${Math.round(timeout)}s (request ${rid}). Check later with \`um fal result ${endpoint} ${rid}\``,
      );
    await Bun.sleep(age < 30 ? 1000 : 3000);
  }
}

/** Runs the job, downloads each output file, and writes a manifest line. Returns `{ files, result }`. */
export async function generate(endpoint, input, out, name) {
  const inp = {};
  for (const [k, v] of Object.entries(input))
    if (v != null)
      inp[k] =
        Array.isArray(v) && k.endsWith("urls")
          ? await Promise.all(v.map(asUrl))
          : k.endsWith("url")
            ? await asUrl(v)
            : v;
  const result = await runJob(endpoint, inp);
  const files = await downloadOutputs(result, out, name);
  const rec = {
    t: new Date().toLocaleString("sv").replace(" ", "T"),
    endpoint,
    name,
    request_id: result._request_id,
    seed: result.seed,
    files,
    input: JSON.parse(
      JSON.stringify(inp, (_k, v) =>
        typeof v === "string" && v.startsWith("data:")
          ? `${v.slice(0, 120)}...`
          : v,
      ),
    ),
  };
  fs.appendFileSync(
    path.join(out, "fal_manifest.jsonl"),
    `${JSON.stringify(rec)}\n`,
  );
  for (const f of files) console.log(f);
  return { files, result };
}

/** The input fields (type, default, enum) and output fields of an endpoint, from its public OpenAPI. */
async function schema(endpoint) {
  const api = await req(
    "GET",
    `https://fal.ai/api/openapi/queue/openapi.json?${query({ endpoint_id: endpoint })}`,
    { auth: false },
  );
  const named = (ref) => ref?.split("/").pop();
  const resolve = (ref) => api.components?.schemas?.[named(ref)] || {};
  let inp = {};
  let out = {};
  for (const [p, ops] of Object.entries(api.paths || {})) {
    if (ops.post?.requestBody && !Object.keys(inp).length)
      inp = resolve(
        ops.post.requestBody.content["application/json"].schema.$ref,
      );
    if (p.endsWith("/requests/{request_id}") && ops.get)
      out = resolve(
        ops.get.responses?.[200]?.content?.["application/json"]?.schema?.$ref,
      );
  }
  const fields = (s) =>
    Object.fromEntries(
      Object.entries(s.properties || {}).map(([k, v]) => {
        const d = {};
        for (const x of ["type", "default", "enum", "description"])
          if (x in v) d[x] = v[x];
        if (v.anyOf)
          d.type = v.anyOf.map((a) => a.type || named(a.$ref)).join(" | ");
        if (v.$ref) d.type = named(v.$ref);
        if (d.description) d.description = d.description.slice(0, 160);
        return [k, d];
      }),
    );
  return {
    endpoint,
    required: inp.required || [],
    input: fields(inp),
    output: fields(out),
  };
}

/** key=value (a string) and key:=json (a number, bool, list, or object). A value '@file' uploads a local file. */
export const kv = (pairs = []) =>
  Object.fromEntries(
    pairs.map((p) => {
      const m =
        /^([^=]*?)(:?)=(.*)$/s.exec(p) ??
        die(`bad argument ${JSON.stringify(p)}: use key=value or key:=json`);
      try {
        return [m[1], m[2] ? JSON.parse(m[3]) : m[3]];
      } catch {
        return die(`bad JSON in ${JSON.stringify(p)}`);
      }
    }),
  );

const stem = (file) => path.parse(file).name;
const pick = (flag, v, choices) =>
  choices.includes(v)
    ? v
    : die(`--${flag} must be one of ${choices.join(", ")}`);

// Option types of the recipes (see `data/fal.json`).
// A type that is not here keeps the string.
const CONV = {
  b: (x) => !!x,
  nb: (x) => !x,
  l: (x) => x.split(","),
  n: num,
  ns: (x) => String(num(x)),
  ms: (x) => Math.trunc(num(x) * 1000),
};
const str = { type: "string" };
const flag = { type: "boolean" };
const FLAGS = { b: flag, nb: flag, m: { ...str, multiple: true } };
const COMMON = {
  out: {
    ...str,
    default: "assets/gen",
    help: "output folder (default assets/gen)",
  },
  name: { ...str, help: "output file stem" },
  model: { ...str, help: "override the endpoint" },
  set: {
    ...FLAGS.m,
    help: "K=V extra model input (repeatable, K:=json for numbers)",
  },
};
/** A whole-string `{name}` keeps the type of the value. Any other string fills each `{name}` as text. */
const fill = (t, vals) => {
  const whole = /^\{([\w-]+)\}$/.exec(t)?.[1];
  return whole
    ? vals[whole]
    : typeof t === "string"
      ? t.replace(/\{([\w-]+)\}/g, (_, k) => vals[k])
      : t;
};

/** One command. `pos` names the positional arguments, and `opts` adds options to the common ones. */
function recipe(help, pos, opts, fn, { out = true, rest = false } = {}) {
  const usage = pos.map((x) => `<${x}>`).join(" ");
  return {
    help,
    usage: `${usage}${rest ? " [key=value ...]" : ""} [options]`,
    options: { ...(out && COMMON), ...opts },
    async run(v, p) {
      if (rest ? p.length < pos.length : p.length !== pos.length)
        die(`expected: ${usage}`);
      await fn(v, p);
    },
  };
}

/** Runs a recipe of `data/fal.json` with `--model` and `--set` applied. */
async function runRecipe(r, v, p) {
  const vals = { style: SPRITE_STYLE };
  r.pos.forEach((k, i) => {
    vals[k] = p[i];
  });
  for (const [k, s] of Object.entries(r.opts)) {
    const raw = v[k] ?? s.d;
    if (s.req && !raw?.length) die(`--${k} is required (${s.req})`);
    if (s.c) pick(k, String(raw), s.c);
    vals[k] = CONV[s.t]?.(raw) ?? raw;
  }
  const e = r.on
    ? { ...r, ...r.cases[pick(r.on, vals[r.on], Object.keys(r.cases))] }
    : r;
  const ep = v.model || e.model;
  const alt = e.alt && !ep.startsWith(e.alt.unless) ? e.alt : e;
  const [from, suffix] = e.name;
  const name =
    v.name ||
    (suffix == null ? slug(vals[from], "asset") : stem(vals[from]) + suffix);
  const input = Object.fromEntries(
    Object.entries(alt.input).map(([k, t]) => [k, fill(t, vals)]),
  );
  const res = await generate(ep, { ...input, ...kv(v.set) }, v.out, name);
  if (alt !== e)
    for (const f of res.files)
      await generate(
        DATA.recipes.rmbg.model,
        { image_url: f, output_format: "png" },
        v.out,
        `${stem(f)}_cut`,
      );
}

const solo = { out: false };

export const commands = {
  ...Object.fromEntries(
    Object.entries(DATA.recipes).map(([k, r]) => [
      k,
      recipe(
        r.help,
        r.pos,
        Object.fromEntries(
          Object.entries(r.opts).map(([o, s]) => [
            o,
            { ...(FLAGS[s.t] ?? str), help: s.h ?? s.c?.join(", ") },
          ]),
        ),
        (v, p) => runRecipe(r, v, p),
      ),
    ]),
  ),
  run: recipe(
    "any endpoint: key=value, key:=json, key=@file",
    ["endpoint"],
    {},
    (v, [endpoint, ...params]) =>
      generate(
        endpoint,
        kv(params),
        v.out,
        v.name || endpoint.split("/").pop(),
      ),
    { rest: true },
  ),
  search: recipe(
    "search the fal catalog",
    ["query"],
    {
      category: {
        ...str,
        help: "text-to-image, image-to-3d, text-to-audio, ...",
      },
      limit: str,
    },
    async (v, [q]) => {
      const params = query({ q, status: "active", limit: num(v.limit) ?? 20 });
      if (v.category) params.set("category", v.category);
      for (const m of (await req("GET", `${PLATFORM}/models?${params}`))
        .models || []) {
        const d = m.metadata ?? {};
        console.log(
          `${String(m.endpoint_id).padEnd(55)} ${(d.category || "").padEnd(18)} ${(d.date || "").slice(0, 10)}  ${d.display_name ?? ""}`,
        );
      }
    },
    solo,
  ),
  schema: recipe(
    "input and output fields of an endpoint",
    ["endpoint"],
    {},
    async (_v, [endpoint]) => emit(await schema(endpoint)),
    solo,
  ),
  price: recipe(
    "pricing of an endpoint",
    ["endpoint"],
    {},
    async (_v, [endpoint]) =>
      emit(
        await req(
          "GET",
          `${PLATFORM}/models/pricing?${query({ endpoint_id: endpoint })}`,
        ),
      ),
    solo,
  ),
  result: recipe(
    "fetch (and download) a finished request",
    ["endpoint", "request_id"],
    {},
    async (v, [endpoint, rid]) => {
      const res = await req("GET", `${QUEUE}/${endpoint}/requests/${rid}`);
      await downloadOutputs(res, v.out, v.name || rid);
      emit(res);
    },
  ),
  upload: recipe(
    "upload a local file and print its URL",
    ["file"],
    {},
    async (_v, [file]) => console.log(await upload(file)),
    solo,
  ),
};
