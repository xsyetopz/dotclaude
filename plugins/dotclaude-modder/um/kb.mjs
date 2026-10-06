// A port of `um/kb.py` from universal-modder.
// No notes ship with the plugin, so `kb` reads `knowledge/` of the upstream repository.
// By default it reads the reviewed upstream commit `kb.pin`, and `UM_KB_BRANCH=main` gives the latest notes.
// The pin is not in a fork, so `UM_KB_REPO` without `UM_KB_BRANCH` reads `main` of the fork.
// Strangers write the notes, so `show` and `search` wrap note text in `<untrusted_field_note>` tags.
// Search matches at the start of a word (upstream PR #111), and `show` stays inside the notes folder.

import fs from "node:fs";
import path, { dirname, join, relative } from "node:path";
import { dataDir, die, num, run } from "./common.mjs";
import kb from "./data/kb.json";
import { DECOMP_PATTERNS, SECRET_PATTERNS } from "./publish.mjs";

export const help = `\n${kb.help.join("\n")}\n`;

const env = (k) => process.env[`UM_KB_${k}`];
const repo = () => env("REPO") || "rehan-remade/universal-modder";
const branch = () => env("BRANCH") || (env("REPO") ? "main" : kb.pin);
const [BLOCK_WARN, BLOCK_FAIL, NOTE_KB, MEDIA_MB] = [60, 150, 120, 1.5];
const exists = (p) => fs.existsSync(p);
const read = (p) => fs.readFileSync(p, "utf8");
const write = (p, text) => fs.writeFileSync(p, text);
const rel = (root, p) => relative(root, p).replaceAll("\\", "/");
const list = (v) => (Array.isArray(v) ? v : []);
/** `fmt` fills `{name}` in a template, and `msg` fills `{0}`, `{1}` and so on in a message of `kb.json`. */
const fmt = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "-");
const msg = (key, ...args) => fmt(kb.msgs[key], args);
const NOT_NOTE = /^(engines\/|(README|INDEX|TEMPLATE)\.md$)/;

const mds = (dir) =>
  fs
    .readdirSync(dir, { recursive: true })
    .map((r) => r.replaceAll("\\", "/"))
    .filter((f) => f.endsWith(".md"))
    .sort();

export function localRoot() {
  for (let d = process.cwd(); ; d = dirname(d)) {
    if (exists(join(d, "knowledge", "TEMPLATE.md")))
      return join(d, "knowledge");
    if (dirname(d) === d) return null;
  }
}

export function cacheRoot() {
  const key = `${repo()}@${branch()}`.replaceAll("/", "__");
  return join(dataDir(), "kb", key, "knowledge");
}

export async function sync(quiet = false) {
  const get = async (url) => {
    const signal = AbortSignal.timeout(60_000);
    const res = await fetch(url, { headers: kb.headers, signal });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res;
  };
  const api = `https://api.github.com/repos/${repo()}/git/trees/${branch()}`;
  const tree = await (await get(`${api}?recursive=1`)).json();
  if (tree.truncated) die(msg("truncated", repo()));
  const paths = (tree.tree ?? [])
    .map((t) => t.type === "blob" && t.path)
    .filter((p) => /^knowledge\/.*\.(md|json)$/.test(p));
  const root = cacheRoot();
  const tmp = join(dirname(root), "knowledge.tmp");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  for (const p of paths) {
    const dst = join(tmp, p.slice("knowledge/".length));
    fs.mkdirSync(dirname(dst), { recursive: true });
    const url = `https://raw.githubusercontent.com/${repo()}/${branch()}/${p}`;
    write(dst, Buffer.from(await (await get(url)).arrayBuffer()));
  }
  fs.rmSync(root, { recursive: true, force: true });
  fs.renameSync(tmp, root);
  write(join(root, ".synced"), String(Date.now() / 1000));
  if (!quiet) console.log(msg("synced", paths.length, repo(), root));
  return root;
}

export async function resolveRoot(explicit, remote = false) {
  const loc = explicit || process.env.UM_KB || (remote ? null : localRoot());
  if (loc) return loc;
  const root = cacheRoot();
  const stamp = join(root, ".synced");
  if (exists(stamp) && Date.now() / 1000 - Number(read(stamp) || 0) <= 86400)
    return root;
  return sync(true).catch((e) => {
    if (!exists(root)) die(msg("syncFailed", e.message, repo()));
    console.error(msg("staleCache", e.message, root));
    return root;
  });
}

export function untrusted(text, source) {
  // A note must not close the tag, and it must not open a fake one.
  const safe = text.replace(
    /<(\/?)untrusted_field_note/gi,
    "&lt;$1untrusted_field_note",
  );
  const src = source.replace(/["<>\r\n]/g, "_");
  return `<untrusted_field_note source="${src}">\n${safe}\n</untrusted_field_note>`;
}

const emit = (root, text, p) => {
  const cached = path.resolve(root) === path.resolve(cacheRoot());
  const url = `https://github.com/${repo()}/blob/${branch()}/knowledge/${rel(root, p)}`;
  console.log(untrusted(text, cached ? url : String(p)));
};

export function parse(file) {
  const text = read(file);
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text);
  if (!m) return [{}, text];
  let meta;
  try {
    meta = Bun.YAML.parse(m[1]) ?? {};
  } catch (e) {
    return [{ _yaml_error: e.message }, m[2]];
  }
  // YAML 1.2 keeps a date as a string, but upstream (PyYAML) rejects a date that does not exist, like 2026-09-31.
  for (const v of Object.values(meta)) {
    const d = typeof v === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (d && new Date(Date.UTC(+d[1], +d[2] - 1, +d[3])).getUTCDate() !== +d[3])
      return [{ _yaml_error: `day is out of range for month: ${v}` }, m[2]];
  }
  return [typeof meta === "object" && !Array.isArray(meta) ? meta : {}, m[2]];
}

export const notes = (root) =>
  mds(root)
    .filter((f) => !NOT_NOTE.test(f))
    .map((f) => [join(root, f), ...parse(join(root, f))]);

export const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "note";

/** How often `text` has a term at the start of a word: "rust" finds "Rust" and "rusty", not "trust" or "frustum". */
const count = (term, text) => {
  const rx = `(?<![a-z0-9])${RegExp.escape(term.toLowerCase())}`;
  return text.toLowerCase().match(new RegExp(rx, "g"))?.length ?? 0;
};

export function search(root, terms, { game, engine, route, limit = 10 } = {}) {
  const words = terms.filter((t) => t.trim());
  const res = [];
  for (const [p, meta, body] of notes(root)) {
    const s = (k) => String(meta[k] ?? "");
    const ok = (x, k) => !x || x.toLowerCase() === s(k).toLowerCase();
    const also = list(meta.games_also).map(String);
    const games = `${slug(s("game"))} ${also.map(slug).join(" ")}`;
    if (!ok(engine, "engine") || !ok(route, "route")) continue;
    if (game && !games.includes(slug(game))) continue;
    const tags = ["tags", "tools"].flatMap((k) => list(meta[k]));
    const fields = [
      [5, s("title")],
      [4, [s("game"), ...also].join(" ")],
      [3, [s("engine"), s("route"), ...tags].join(" ")],
    ];
    let score = 0;
    for (const t of words) {
      for (const [w, f] of fields) score += count(t, f) ? w : 0;
      score += Math.min(5, count(t, body));
    }
    if (words.length && !score) continue;
    const hits = body
      .split(/\r?\n/)
      .map((ln) => ln.trim())
      .filter((ln) => ln && words.some((t) => count(t, ln)))
      .slice(0, 3);
    const facts = kb.resultKeys.map((k) => [k, meta[k]]);
    res.push({ score, path: rel(root, p), ...Object.fromEntries(facts), hits });
  }
  return res.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function checkNote(file) {
  const [fails, warns] = [[], []];
  const f = (key, ...args) => fails.push(msg(key, ...args));
  const w = (key, ...args) => warns.push(msg(key, ...args));
  const text = read(file);
  const [meta, body] = parse(file);
  const only = (key, ...args) => [[`${file}: ${msg(key, ...args)}`], []];
  if (!Object.keys(meta).length) return only("noFront");
  if ("_yaml_error" in meta) return only("badYaml", meta._yaml_error);
  const oneOf = (key, values, put) =>
    meta[key] &&
    !values.includes(meta[key]) &&
    put("oneOf", key, meta[key], values.join(", "));
  const kind = meta.kind ?? "game";
  for (const k of kind === "game" ? kb.gameKeys : kb.techKeys)
    if (meta[k] == null || meta[k].length === 0) f("missingKey", k);
  if (!["game", "technique"].includes(kind)) f("badKind", JSON.stringify(kind));
  if (kind === "game") {
    oneOf("route", kb.routes, f);
    oneOf("platform", kb.platforms, w);
    const { ENGINES } = await import("./scan.mjs");
    if (meta.engine && !(meta.engine in ENGINES) && meta.engine !== "unknown")
      w("engine", meta.engine, Object.keys(ENGINES).sort().join(", "));
    for (const s of kb.gameSections)
      if (!new RegExp(`^##\\s+${s}`, "im").test(body))
        f("missingSection", s[0].toUpperCase() + s.slice(1));
    const numbered = /^##\s+Gotchas.*?\n(?:.*\n)*?\s*1\./im.test(body);
    if (/^##\s+.*gotchas/im.test(body) && !numbered) w("noGotchas");
  }
  oneOf("status", kb.statuses, f);
  if (meta.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(meta.date)))
    f("badDate", meta.date);
  if (meta.agents !== undefined && !Array.isArray(meta.agents)) f("badAgents");
  if (!path.basename(file).includes("TEMPLATE")) {
    if (meta.title === kb.exampleTitle) f("exampleTitle");
    const left = kb.placeholders.filter((ph) => text.includes(ph));
    if (left.length) f("unfilled", left.map((x) => `'${x}'`).join(", "));
  }
  for (const [l, rx] of SECRET_PATTERNS) if (rx.test(text)) f("secret", l);
  for (const [, b] of body.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    const n = b.split("\n").length - 1;
    if (n > BLOCK_FAIL) f("blockFail", n, BLOCK_FAIL);
    else if (n > BLOCK_WARN) w("blockWarn", n, BLOCK_WARN);
    // `match` and not `test`: these patterns have the `g` flag.
    for (const [l, rx] of DECOMP_PATTERNS) if (b.match(rx)) w("decomp", l);
  }
  if (new RegExp(kb.userPath).test(text)) w("userPath");
  const bytes = Buffer.byteLength(text);
  if (bytes > NOTE_KB * 1024) w("noteSize", Math.floor(bytes / 1024), NOTE_KB);
  for (const [, src] of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const img = path.resolve(dirname(file), src);
    const size = fs.statSync(img, { throwIfNoEntry: false })?.size;
    if (src.startsWith("http")) continue;
    if (size === undefined) f("noImage", src);
    else if (size > MEDIA_MB * 2 ** 20)
      f("imageSize", src, (size / 2 ** 20).toFixed(1), MEDIA_MB);
  }
  return [fails, warns];
}

export function buildIndex(root) {
  const rows = notes(root).map(([p, m]) => ({ path: rel(root, p), ...m }));
  const sorted = (kind, key) =>
    rows
      .filter((r) => (r.kind ?? "game") === kind)
      .sort((a, b) => +(key(a) > key(b)) - +(key(a) < key(b)));
  const low = (v) => `${v ?? ""}`.toLowerCase();
  const games = sorted("game", (r) => `${low(r.game)}\0${r.date ?? ""}`);
  const techs = sorted("technique", (r) => low(r.title));
  const esc = (s) => String(s || "").replaceAll("|", "\\|");
  const joined = (v) => esc(list(v).join(", "));
  const gameRow = (r) => {
    const g = [esc(r.game), ...list(r.games_also).map(esc)].join(" + ");
    return `| ${g} | [${esc(r.title)}](${r.path}) | ${esc(r.engine)} | ${esc(r.route)} | ${esc(r.status)} | ${joined(r.agents)} | ${esc(r.date)} |`;
  };
  const lines = [
    ...kb.index.head,
    `## Games (${games.length} notes)`,
    "",
    ...kb.index.table,
    ...games.map(gameRow),
    "",
    `## Techniques (${techs.length} notes)`,
    "",
    ...techs.map((r) => `- [${esc(r.title)}](${r.path}) · ${joined(r.tags)}`),
    ...kb.index.tail,
  ];
  return [lines.join("\n"), rows];
}

const writeIndex = (root) => {
  const [idx, rows] = buildIndex(root);
  write(join(root, "INDEX.md"), idx);
  write(join(root, "index.json"), `${JSON.stringify(rows, null, 1)}\n`);
  return rows;
};

function dump(meta) {
  const scalar = (v) => Bun.YAML.stringify(v).trim();
  return Object.entries(meta)
    .map(([k, v]) =>
      Array.isArray(v) && v.length
        ? `${k}:\n${v.map((x) => `  - ${scalar(x)}`).join("\n")}`
        : `${k}: ${Array.isArray(v) ? "[]" : scalar(v)}`,
    )
    .join("\n");
}

export async function newNote(root, opts = {}) {
  const { game, title, kind = "game", fromScan, engine, route } = opts;
  const [template, tbody] = parse(join(root, "TEMPLATE.md"));
  const meta = {
    ...template,
    kind,
    title,
    date: new Date().toISOString().slice(0, 10),
    agents: [opts.agent || process.env.UM_AGENT || "FILL IN: agent (model)"],
    ...kb.noteDefaults,
  };
  if (kind === "game") {
    Object.assign(meta, kb.gameDefaults);
    for (const [k, v] of Object.entries({ game, engine, route }))
      if (v) meta[k] = v;
    if (fromScan) {
      const s = await (await import("./scan.mjs")).scan(fromScan);
      Object.assign(meta, {
        game: game || s.name,
        engine: s.engine.key,
        anti_cheat: s.anti_cheat.join(", ") || "none found by um scan",
        game_version:
          `FILL IN (${s.store || "store?"} ${s.appid || ""})`.trim(),
        tools: s.mod_loaders_installed,
      });
    }
  } else for (const k of Object.keys(kb.gameDefaults)) delete meta[k];
  const body =
    kind === "technique"
      ? `# ${title}\n\n${kb.techniqueBody}`
      : tbody.replace(/^# .*$/m, () => `# ${title}`);
  const dir = kind === "game" ? join("games", slug(meta.game)) : "techniques";
  const file = opts.out || join(root, dir, `${slug(title)}.md`);
  if (exists(file)) die(`${file} exists`);
  fs.mkdirSync(dirname(file), { recursive: true });
  write(file, `---\n${dump(meta)}\n---\n${body}`);
  return file;
}

/** The --head for `gh pr create`: a PR from a fork needs "<fork owner>:<branch>" (`forkUrl` is null when you push to the repository itself). */
export function prHead(branchName, forkUrl) {
  const m = /github\.com[:/]+([^/]+)\//.exec(forkUrl || "");
  return m ? `${m[1]}:${branchName}` : branchName;
}

export async function openPr(rel, yes) {
  // `git add` runs at the repo root, so the path must not depend on the cwd.
  const [file, root] = [path.resolve(rel), localRoot()];
  if (!root) die("run this inside a clone of the repo (or your fork)");
  const cwd = dirname(root);
  const [meta] = parse(file);
  const [fails] = await checkNote(file);
  if (fails.length) die(msg("fixFirst", fails.join("\n  ")));
  const name = `kb/${slug(meta.game || "technique")}-${slug(meta.title || "note")}`;
  const br = name.slice(0, 80);
  const mediaDir = join(dirname(file), "media");
  const media = exists(mediaDir) ? fs.readdirSync(mediaDir) : [];
  const gh = Bun.which("gh");
  const push = ["gh", "api", `repos/${repo()}`, "--jq", ".permissions.push"];
  // The dry run makes no network call, so it shows the commands for a fork.
  const canPush =
    yes && gh && run(push, { check: false }).stdout.trim() === "true";
  const vars = {
    br,
    repo: repo(),
    remote: canPush ? "origin" : "fork",
    title: `kb: ${meta.title}${meta.game ? ` (${meta.game})` : ""}`,
    // `fmt` gives "-" for a missing game, engine, or route.
    body: fmt(kb.prBody, { ...meta, agents: list(meta.agents).join(", ") }),
  };
  const files = [file, ...kb.indexFiles.map((n) => join(root, n))];
  files.push(...media.map((n) => join(mediaDir, n)));
  const { pre, fork, post } = kb.pr;
  const cmds = [...pre, ...(canPush ? [] : [fork]), ...post].map((c) =>
    c.flatMap((a) => (a === "{files}" ? files.map(String) : fmt(a, vars))),
  );
  if (!yes) {
    console.log(msg("dryRun", repo()));
    for (const c of cmds)
      console.log(
        `  ${(c.join(" ").length < 200 ? c : [...c.slice(0, 6), "..."]).join(" ")}`,
      );
    return;
  }
  if (!gh) die(kb.msgs.needGh);
  writeIndex(root);
  const forkUrl = () =>
    run(["git", "remote", "get-url", "fork"], { check: false, cwd });
  for (const c of cmds) {
    const head = c.slice(0, 3).join(" ");
    if (head === "um kb index") continue;
    if (head === "gh repo fork" && forkUrl().status === 0) continue;
    if (head === "gh pr create" && vars.remote === "fork")
      c[c.indexOf("--head") + 1] = prHead(br, forkUrl().stdout.trim());
    const r = run(c, { check: false, cwd });
    const err = (r.stderr || r.stdout).trim().slice(-800);
    if (r.status) die(msg("failed", c.slice(0, 4).join(" "), err));
    if (head === "gh pr create") console.log(r.stdout.trim());
  }
}

const checkRoute = (r) =>
  r && !kb.routes.includes(r) && die(msg("badRoute", kb.routes.join(", ")), 2);

export const commands = {
  search: {
    ...kb.commands.search,
    async run(v, terms) {
      checkRoute(v.route);
      const root = await resolveRoot(v.root, v.remote);
      const limit = num(v.limit);
      const res = search(root, terms, { ...v, limit });
      // One tag around all the JSON, so that the output has the same fields as upstream.
      if (v.json) return emit(root, JSON.stringify(res, null, 1), root);
      if (!res.length) console.log(msg("noMatch", root));
      for (const r of res) {
        const facts = kb.resultKeys.slice(1).map((k) => r[k]);
        const hit = (h) => `     | ${h.replace(/^>\s*/, "").slice(0, 160)}`;
        const head = `   ${r.title}  [${facts.filter(Boolean).join(" | ") || "technique"}]`;
        const text = [r.path, head, ...r.hits.map(hit)].join("\n");
        emit(root, text, join(root, r.path));
      }
    },
  },
  show: {
    ...kb.commands.show,
    async run(v, [note]) {
      if (!note) die("show needs <note>", 2);
      const root = await resolveRoot(v.root, v.remote);
      let p = join(root, note);
      if (!exists(p) || fs.statSync(p).isDirectory()) {
        const found = mds(root).find((f) => f.includes(note));
        p = join(root, found ?? die(`no note '${note}' in ${root}`));
      }
      // The note name can come from untrusted search output, so `../` and a link must not leave the notes folder.
      const out = relative(fs.realpathSync(root), fs.realpathSync(p));
      if (/^\.\.(?:[\\/]|$)/.test(out) || path.isAbsolute(out))
        die(`note '${note}' is outside ${root}`);
      emit(root, read(p), p);
    },
  },
  new: {
    ...kb.commands.new,
    async run(v) {
      if (!v.title) die("new needs --title", 2);
      if (!["game", "technique"].includes(v.kind))
        die("--kind must be game or technique", 2);
      checkRoute(v.route);
      const root = v.root || localRoot() || die(kb.msgs.noClone);
      const p = await newNote(root, { ...v, fromScan: v["from-scan"] });
      console.log(`${p}\n${msg("next", p)}`);
    },
  },
  check: {
    ...kb.commands.check,
    async run(v, given) {
      const root = v.root || localRoot();
      const all = root ? notes(root).map(([p]) => p) : [];
      const paths = given.length ? given : all;
      let bad = 0;
      for (const p of paths) {
        const [fails, warns] = await checkNote(p);
        for (const x of fails) console.log(`FAIL ${p}: ${x}`);
        for (const x of warns) console.log(`WARN ${p}: ${x}`);
        bad += fails.length ? 1 : 0;
      }
      const idx = root && join(root, "INDEX.md");
      const stale = idx && (!exists(idx) || read(idx) !== buildIndex(root)[0]);
      if (v.index && !given.length && stale) {
        console.log(kb.msgs.staleIndex);
        bad++;
      }
      console.log(`${bad ? "FAIL" : "PASS"}: ${paths.length} notes checked`);
      return bad ? 1 : 0;
    },
  },
  index: {
    ...kb.commands.index,
    run(v) {
      const root = v.root || localRoot() || die("no local knowledge/ folder");
      const n = writeIndex(root).length;
      console.log(`${join(root, "INDEX.md")}: ${n} notes`);
    },
  },
  sync: { ...kb.commands.sync, run: async () => void (await sync()) },
  pr: {
    ...kb.commands.pr,
    run: (v, [note]) =>
      note ? openPr(note, v.yes) : die("pr needs <note>", 2),
  },
};
