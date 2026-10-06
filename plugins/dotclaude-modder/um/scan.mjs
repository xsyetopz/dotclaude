// `um scan`: find installed games and fingerprint one.
// A port of `um/scan.py` from universal-modder.
// Everything here is read-only.
// The knowledge tables (engines, known games, anti-cheat, loaders, saves) are in `data/scan.json`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  die,
  emit,
  isMac,
  isWindows,
  isWsl,
  psExe,
  run,
  toPosix,
} from "./common.mjs";
import data from "./data/scan.json" with { type: "json" };

export const help = `
Find installed games and fingerprint one: engine, scripting runtime, anti-cheat, mod loaders, saves.

  um scan --list                # Steam, Epic and Xbox installs on this machine (Windows, WSL, Linux, macOS)
  um scan terraria              # a fuzzy name or a path: print the report
  um scan "C:\\Games\\Foo" --json   # machine-readable, for agents

The report ends with ranked modding routes and the playbook to read next
(skills/mod-any-game/references/engines/*.md).
`;

const MAX_ENTRIES = 80_000;
const MAX_DEPTH = 6;
const P = data.patterns;

/** key: [label, playbook, route]. The key order is the detection order. */
export const ENGINES = data.engines;
/** Known games: better routes than the engine default. */
export const KNOWN = data.known;

const attempt = (fn, fallback = null) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};
const isDir = (p) => attempt(() => fs.statSync(p).isDirectory(), false);
const real = (p) => fs.realpathSync(p);
const readText = (p) => fs.readFileSync(p, "utf8");
const readAt = (file, n, pos = 0) => {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(n);
    return buf.subarray(0, fs.readSync(fd, buf, 0, n, pos));
  } finally {
    fs.closeSync(fd);
  }
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const plainKey = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Fill `{name}` slots, one result per combination. A slot with no value gives no result. */
const expand = (template, vars) =>
  [...template.matchAll(/{(\w+)}/g)].reduce(
    (outs, [slot, k]) =>
      (vars[k] ?? []).flatMap((v) => outs.map((o) => o.replace(slot, () => v))),
    [template],
  );

/** Minimal Valve KeyValues parser (libraryfolders.vdf, appmanifest_*.acf). */
export function vdf(text) {
  const stack = [];
  let cur = {};
  let key = null;
  for (const [, s, brace] of text.matchAll(/"((?:[^"\\]|\\.)*)"|([{}])/g)) {
    switch (brace) {
      case "{":
        stack.push(cur);
        cur = cur[key] = {};
        key = null;
        break;
      case "}":
        cur = stack.pop() ?? cur;
        break;
      default:
        if (key === null) key = s;
        else [cur[key], key] = [s.replaceAll("\\\\", "\\"), null];
    }
  }
  return cur;
}

/** Run a Windows program on Windows or from WSL. A program that fails to start gives "". */
const winRun = (cmd, timeout) => {
  const cwd = isWsl() ? "/mnt/c" : undefined;
  return attempt(
    () => run(cmd, { check: false, timeout, cwd }).stdout.trim(),
    "",
  );
};

const SHELL_FOLDERS = {
  profile: "UserProfile",
  documents: "MyDocuments",
  appdata: "ApplicationData",
  localappdata: "LocalApplicationData",
};
let winFoldersCache;
/** The user's Windows shell folders (Documents is often redirected into OneDrive), also from WSL. */
export function winFolders() {
  if (!(isWindows() || isWsl())) return {};
  if (!winFoldersCache) {
    const get = Object.values(SHELL_FOLDERS).map(
      (n) => `[Environment]::GetFolderPath('${n}')`,
    );
    const ps = [psExe(), "-NoProfile", "-Command", `@(${get}) -join '|'`];
    const out = winRun(ps, 30).split("|");
    winFoldersCache = Object.fromEntries(
      Object.keys(SHELL_FOLDERS).flatMap((k, i) =>
        out[i] ? [[k, toPosix(out[i])]] : [],
      ),
    );
  }
  return winFoldersCache;
}

/** Where Steam says it lives (Windows registry). Many installs are not under Program Files (e.g. C:\\Steam). */
export function steamRegistryRoot() {
  if (!(isWindows() || isWsl())) return null;
  for (const [key, value] of [
    ["HKCU\\Software\\Valve\\Steam", "SteamPath"],
    ["HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"],
  ]) {
    const out = winRun(["reg.exe", "query", key, "/v", value], 15);
    const m = new RegExp(`${value}\\s+REG_SZ\\s+(.+)`).exec(out);
    if (m) return toPosix(m[1].trim());
  }
  return null;
}

export function steamRoots(registryRoot = steamRegistryRoot()) {
  const s = data.steam;
  const vars = {
    home: [os.homedir()],
    pf86: [process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)"],
  };
  const cands = [
    ...(isWindows() ? s.win : []),
    ...(isWsl() ? s.wsl : []),
    ...(isMac() ? s.mac : []),
    ...(isWindows() ? [] : s.unix),
  ].flatMap((t) => expand(t, vars));
  const roots = [registryRoot, ...cands]
    .map((c) => c && attempt(() => real(c)))
    .filter((r) => r && isDir(path.join(r, "steamapps")));
  return [...new Set(roots)];
}

export function steamGames(roots = steamRoots()) {
  const libs = roots.flatMap((root) => {
    const lf = path.join(root, "steamapps", "libraryfolders.vdf");
    const extra = fs.existsSync(lf)
      ? Object.values(vdf(readText(lf)).libraryfolders ?? {})
          .filter((v) => v && typeof v === "object" && v.path)
          .map((v) => toPosix(v.path))
      : [];
    return [root, ...extra];
  });
  const games = [];
  const seen = new Set();
  for (const lib of libs) {
    const apps = path.join(lib, "steamapps");
    if (!isDir(apps) || seen.has(real(apps))) continue;
    seen.add(real(apps));
    for (const f of fs
      .readdirSync(apps)
      .filter((n) => /^appmanifest_.*\.acf$/.test(n))) {
      const st = vdf(readText(path.join(apps, f))).AppState ?? {};
      const dir = path.join(apps, "common", st.installdir ?? "");
      const ws = path.join(apps, "workshop", "content", st.appid ?? "");
      if (!st.installdir || !isDir(dir)) continue;
      const workshop = isDir(ws) ? ws : null;
      const { appid = null, name = null } = st;
      games.push({ store: "steam", appid, name, path: dir, workshop });
    }
  }
  return games;
}

/** `C:/` on Windows, `/mnt/c/` in WSL, else null. */
const driveRoot = (d) =>
  isWindows() ? `${d.toUpperCase()}:/` : isWsl() ? `/mnt/${d}/` : null;

export function epicGames() {
  const c = driveRoot("c");
  const dir = `${c}ProgramData/Epic/EpicGamesLauncher/Data/Manifests`;
  const items = c ? attempt(() => fs.readdirSync(dir), []) : [];
  return items
    .filter((f) => f.endsWith(".item"))
    .flatMap((item) =>
      attempt(() => {
        const d = JSON.parse(readText(path.join(dir, item)));
        const p = toPosix(d.InstallLocation ?? "");
        const game = { store: "epic", appid: d.AppName ?? null };
        return p && isDir(p)
          ? [{ ...game, name: d.DisplayName ?? null, path: p }]
          : [];
      }, []),
    );
}

export function xboxGames() {
  return [..."cdef"].flatMap((drive) => {
    const root = path.join(driveRoot(drive) ?? "/nonexistent", "XboxGames");
    const names = isDir(root) ? fs.readdirSync(root) : [];
    return names.flatMap((name) => {
      const dir = path.join(root, name);
      const content = path.join(dir, "Content");
      const p = isDir(content) ? content : dir;
      return isDir(dir) ? [{ store: "xbox", appid: null, name, path: p }] : [];
    });
  });
}

export const allGames = () => [...steamGames(), ...epicGames(), ...xboxGames()];

export function resolveGame(query, listGames = allGames) {
  const q0 = toPosix(query);
  const p = path.resolve(
    /^~(?=[/\\]|$)/.test(q0) ? os.homedir() + q0.slice(1) : q0,
  );
  const games = listGames();
  if (isDir(p))
    return (
      games.find((g) => fs.existsSync(g.path) && real(g.path) === real(p)) ?? {
        store: null,
        appid: null,
        name: path.basename(p),
        path: p,
      }
    );
  const q = plainKey(query);
  const hits = games.filter(
    (g) => plainKey(g.name ?? "") === q || g.appid === query,
  );
  const fuzzy = games.filter(
    (g) => q && plainKey((g.name ?? "") + path.basename(g.path)).includes(q),
  );
  if (!(hits.length || fuzzy.length))
    die(
      `no installed game matches '${query}'; pass the install folder instead (\`um scan --list\` shows what was found)`,
    );
  return (hits.length ? hits : fuzzy).sort(
    (a, b) => (a.name ?? "").length - (b.name ?? "").length,
  )[0];
}

/** fnmatch: `*` also matches `/`. */
const matcher = (patterns) => {
  const res = patterns.map((p) =>
    escapeRe(p).replaceAll("\\*", ".*").replaceAll("\\?", "."),
  );
  const re = new RegExp(`^(?:${res.join("|")})$`, "s");
  return (s) => re.test(s);
};

/** Lower-cased relative paths of a game folder (bounded walk). */
export class Index {
  constructor(root) {
    this.root = root;
    this.files = [];
    this.dirs = new Set();
    this.truncated = false;
    this.#walk(root, "", 0);
  }

  /** `rel` is "" or ends with "/". Returns true when the walk must stop. */
  #walk(dir, rel, depth) {
    const entries = attempt(() => fs.readdirSync(dir, { withFileTypes: true }));
    const subs = [];
    for (const e of entries ?? []) {
      const lower = e.name.toLowerCase();
      const isSub =
        e.isDirectory() ||
        (e.isSymbolicLink() && isDir(path.join(dir, e.name)));
      if (!isSub) this.files.push(rel + lower);
      else if (depth < MAX_DEPTH && !P.skipDirs.includes(lower)) {
        this.dirs.add(rel + lower);
        subs.push(e);
      }
    }
    this.truncated = this.files.length > MAX_ENTRIES;
    // Like os.walk, a symlink to a folder is listed but not entered.
    return (
      this.truncated ||
      subs.some(
        (e) =>
          !e.isSymbolicLink() &&
          this.#walk(
            path.join(dir, e.name),
            `${rel}${e.name.toLowerCase()}/`,
            depth + 1,
          ),
      )
    );
  }
  find(...patterns) {
    return this.files.filter(matcher(patterns));
  }
  has(...patterns) {
    return this.files.some(matcher(patterns));
  }
  hasDir(...patterns) {
    return [...this.dirs].some(matcher(patterns));
  }
  /** Case-insensitive rel path -> real path. */
  path(relLower) {
    let cur = this.root;
    for (const part of relLower.split("/")) {
      const names = attempt(() => fs.readdirSync(cur), []);
      const hit = names.find((c) => c.toLowerCase() === part);
      if (hit === undefined) return path.join(this.root, relLower);
      cur = path.join(cur, hit);
    }
    return cur;
  }
}

/** Machine type and whether a PE file is a managed (.NET) assembly. */
export function peInfo(file) {
  const head = attempt(() => readAt(file, 4096));
  if (head?.toString("latin1", 0, 2) !== "MZ" || head.length < 0x40)
    return null;
  const off = head.readUInt32LE(0x3c);
  if (
    off + 0x100 > head.length ||
    head.toString("latin1", off, off + 4) !== "PE\0\0"
  )
    return null;
  const machine = head.readUInt16LE(off + 4);
  const opt = off + 24;
  const dd = opt + (head.readUInt16LE(opt) === 0x10b ? 96 : 112);
  const clrRva =
    dd + 15 * 8 <= head.length ? head.readUInt32LE(dd + 14 * 8) : 0;
  const arch =
    { 332: "x86", 34404: "x64", 43620: "arm64" }[machine] ??
    `0x${machine.toString(16)}`;
  return { arch, managed: clrRva !== 0 };
}

/** First match of each regex source in a (big) binary, read in chunks, bounded by size and time. */
export function grepFile(file, patterns, limitMb = 400, budgetS = 8) {
  const found = new Map();
  const t0 = Date.now();
  let [tail, read, fd] = ["", 0, undefined];
  try {
    fd = fs.openSync(file, "r");
    const chunk = Buffer.alloc(
      Math.max(1, Math.min(16 << 20, fs.fstatSync(fd).size)),
    );
    while (
      found.size < patterns.length &&
      read < limitMb << 20 &&
      Date.now() - t0 < budgetS * 1000
    ) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (!n) break;
      read += n;
      const buf = tail + chunk.toString("latin1", 0, n);
      for (const p of patterns.filter((x) => !found.has(x)))
        found.set(p, new RegExp(p).exec(buf)?.[0]);
      for (const [p, v] of found) if (v === undefined) found.delete(p);
      tail = buf.slice(-256);
    }
  } catch {
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return found;
}

export function unityVersion(ix, dataDir) {
  for (const name of P.unityVersionFiles) {
    const rel = `${dataDir}/${name}`;
    const head = ix.files.includes(rel)
      ? attempt(() => readAt(ix.path(rel), 1 << 16).toString("latin1"), "")
      : "";
    const m = /(?:20\d\d|6000|[45])\.\d+\.\d+[abfpx]\d+/.exec(head);
    if (m) return m[0];
  }
  return null;
}

export function godotPck(file) {
  const version = (head, note) =>
    `${[8, 12, 16].map((o) => head.readUInt32LE(o)).join(".")} (${note})`;
  return attempt(() => {
    const head = readAt(file, 20);
    if (head.toString("latin1", 0, 4) === "GDPC")
      return version(head, `pack format ${head.readUInt32LE(4)}`);
    const end = fs.statSync(file).size;
    const tail = readAt(file, 12, end - 12);
    if (tail.toString("latin1", 8) !== "GDPC") return null; // a pck appended to the executable
    const size = Number(tail.readBigUInt64LE(0));
    const embedded = readAt(file, 20, end - 12 - size);
    return embedded.toString("latin1", 0, 4) === "GDPC"
      ? version(embedded, "embedded in exe")
      : null;
  });
}

/** 'Tom Clancy's Rainbow Six(R) Siege' -> 'tom clancy s rainbow six siege'. */
const plain = (name) =>
  name
    .toLowerCase()
    .replace(/[®™]/g, "")
    .replace(/[\W_]+/g, " ")
    .trim();

/**
 * The `onlineOnly` entry that this game's name is, if any.
 * Whole names only, never substrings: a substring test flagged Rusty Lake ("rust"), Battlefield 1942
 * and the 2009 Modern Warfare 2.
 * Older entries in a series with an online-only sibling are left to the anti-cheat scan.
 */
export function onlineOnly(name) {
  const n = plain(name);
  return data.onlineOnly.includes(n) ? n : null;
}

/** -> `{ hits: [{ key, score, evidence, det }], executables }`, best hit first. */
export function detect(ix) {
  const hits = [];
  const executables = {};
  const add = (key, score, evidence, det = {}) =>
    hits.push({ key, score, evidence, det });
  const first = (n, ...patterns) => ix.find(...patterns).slice(0, n);

  // Detectors with logic of their own, by the engine key of their slot in ENGINES.
  // The other engines are the declarative `rules` of the data file.
  const custom = {
    "unity-mono"() {
      const [dd = ""] = ix
        .find(...P.unityData)
        .map((f) => f.slice(0, f.lastIndexOf("/")));
      if (!(dd || ix.has(...P.unityPlayer))) return;
      const det = { data_dir: dd, version: dd ? unityVersion(ix, dd) : null };
      const info = `${dd}/app.info`;
      const lines =
        dd &&
        ix.files.includes(info) &&
        attempt(() => readText(ix.path(info)).split(/\r\n|\r|\n/));
      if (lines) [det.company = "", det.product = ""] = lines;
      const il2cpp = ix.has(...P.il2cpp);
      const mono = ix.has("*_data/managed/assembly-csharp.dll");
      add(
        il2cpp ? "unity-il2cpp" : "unity-mono",
        100,
        [P.unityEvidence[il2cpp ? 0 : mono ? 1 : 2]],
        det,
      );
    },
    unreal() {
      const shipping = ix.find(...P.shipping);
      const paks = ix.find(...P.paks);
      const found = shipping.length || paks.length;
      if (!(found || ix.hasDir("engine/binaries/thirdparty"))) return;
      const det = {};
      if (shipping.length) {
        det.project = shipping[0].split("/")[0];
        det.exe = shipping[0];
        // FEngineVersion's branch name is a UTF-16 string on Windows (the second pattern).
        const [v] = grepFile(ix.path(shipping[0]), P.ueVersion).values();
        if (v !== undefined)
          det.engine_version = v.replaceAll("\0", "").replace(/^\++/, "");
      }
      det.iostore = ix.has("*.utoc");
      det.paks = paks.length;
      add(
        "unreal",
        shipping.length ? 100 : 70,
        [shipping.length ? "*-Win64-Shipping.exe" : "Content/Paks"],
        det,
      );
    },
    godot() {
      for (const p of [
        ...first(3, "*.pck"),
        ...first(6, "*.exe", "*.x86_64"),
      ]) {
        const version = godotPck(ix.path(p));
        const note = p.endsWith(".pck") ? "" : " (embedded pck)";
        if (version) return add("godot", 100, [p + note], { version });
      }
    },
    gamemaker() {
      const gm = P.gamemaker.find((n) => ix.files.includes(n));
      if (!gm) return;
      const head = attempt(() => readAt(ix.path(gm), 64), Buffer.alloc(0));
      const gen8 =
        head.toString("latin1", 0, 4) === "FORM" &&
        head.toString("latin1", 8, 12) === "GEN8";
      add("gamemaker", 100, [gm], gen8 ? { bytecode_version: head[17] } : {});
    },
    "xna-fna"() {
      const xna = ix.find(...P.xna);
      const exes = ix.files
        .filter((f) => /^[^/]*\.exe$/.test(f))
        .slice(0, 12)
        .map((e) => [e, peInfo(ix.path(e))])
        .filter(([, info]) => info);
      Object.assign(executables, Object.fromEntries(exes));
      const managed = exes.filter(([, i]) => i.managed).map(([e]) => e);
      const configs = ix.find("*.runtimeconfig.json");
      if (xna.length || ix.has("content/*.xnb"))
        add("xna-fna", 95, [
          ...(xna.length ? xna : ["Content/*.xnb"]).slice(0, 2),
          ...managed.slice(0, 1),
        ]);
      else if (managed.length || configs.length)
        add("dotnet", 70, (managed.length ? managed : configs).slice(0, 2));
    },
    source() {
      const gi = first(2, "*/gameinfo.gi");
      if (gi.length || ix.has("game/bin/win64/engine2.dll"))
        add("source2", 100, gi.length ? gi : ["game/bin/win64/engine2.dll"]);
      else if (
        ix.has("*/gameinfo.txt") &&
        (ix.has("*_dir.vpk") || ix.has("bin/engine.dll", "bin/x64/engine.dll"))
      )
        add("source", 100, first(2, "*/gameinfo.txt"));
    },
    electron() {
      if (ix.has(...P.electron, "*/nw.dll"))
        add("electron", 90, first(2, ...P.electron), {
          construct: ix.has("*c3runtime.js", "*c2runtime.js"),
          phaser: ix.has("*phaser*.js"),
        });
      else if (ix.has("index.html") && ix.has("*.js") && !hits.length)
        add("electron", 50, ["index.html + js"]);
    },
    java() {
      const jars = ix.find("*.jar");
      if (
        jars.length &&
        (jars.length <= 5 || ix.hasDir("jre", "jre/*", "jdk*", "java*"))
      )
        add("java", 60, jars.slice(0, 2));
    },
  };

  const matches = (r) =>
    r.when.every((g) => ix.has(...g)) &&
    (r.dirs ?? []).every((d) => ix.hasDir(d));
  for (const key of Object.keys(ENGINES)) {
    const rule = [data.rules[key] ?? []].flat().find(matches);
    if (custom[key]) custom[key]();
    else if (rule) {
      const ev = first(rule.n ?? 1, ...(rule.ev ?? rule.when.flat()));
      const count = ([k, p]) => [k, ix.find(p).length];
      const counts = Object.entries(rule.count ?? {}).map(count);
      const det = { ...rule.det, ...Object.fromEntries(counts) };
      add(key, rule.score, rule.label ? [rule.label] : ev, det);
    }
  }
  if (!hits.length) add("native", 10, ["no known engine signature"]);
  hits.sort((a, b) => b.score - a.score);
  return { hits, executables };
}

/** Existing folders where this game probably keeps saves and config (Windows side). */
export function saveHints(name, det, wf = winFolders()) {
  const docs = [wf.documents, wf.profile && `${wf.profile}/Documents`];
  const vars = {
    ...Object.fromEntries(Object.entries(wf).map(([k, v]) => [k, [v]])),
    home: [os.homedir()],
    docs: docs.filter(Boolean),
  };
  const base = name.replace(/[:®™]/g, "");
  const edition = /\s*(definitive edition|legacy|enhanced|remastered)$/i;
  const names = [
    name,
    base,
    base.split(" - ")[0],
    base.replace(edition, ""),
    det.product,
    det.project,
  ].filter(Boolean);
  const { known, win, mac, linux } = data.saves;
  const perName = (t) => names.flatMap((n) => expand(t, { ...vars, n: [n] }));
  const cands = [
    ...(known[name.toLowerCase()] ?? []).flatMap((t) => expand(t, vars)),
    ...(det.company && det.product && wf.profile
      ? [path.join(wf.profile, "AppData/LocalLow", det.company, det.product)]
      : []),
    ...names.flatMap((n) => win.flatMap((t) => expand(t, { ...vars, n: [n] }))),
    ...(isMac() ? mac : []).flatMap(perName),
    ...(isWindows() || isWsl() ? [] : linux).flatMap(perName),
  ];
  return [...new Set(cands.map((p) => path.normalize(p)))].filter(isDir);
}

/** `listGames` and `folders` are seams for tests: they stand in for the stores and the Windows shell. */
export function scan(
  query,
  { listGames = allGames, folders = winFolders } = {},
) {
  const game = resolveGame(query, listGames);
  const root = game.path;
  const ix = new Index(root);
  const { hits, executables } = detect(ix);
  const { key, score, evidence, det } = hits[0];
  const [label, playbook, route] = ENGINES[key];
  const dirPatterns = (pats) =>
    pats.filter((p) => p.endsWith("/*")).map((p) => p.replace(/[/*]+$/, ""));
  const seen = ([, pats]) => ix.has(...pats) || ix.hasDir(...dirPatterns(pats));
  const anti = data.antiCheat.filter(seen).map(([n]) => n);
  const loaders = data.loaders.filter(seen).map(([n]) => n);
  const name = game.name || path.basename(root);
  const lname = name.toLowerCase();
  const known = Object.entries(KNOWN)
    .sort(([a], [b]) => b.length - a.length)
    .find(([k]) => k === lname || (lname.includes(k) && k.length > 5))?.[1];
  const online = onlineOnly(name);
  const fallback = "fallback when no loader reaches what you need";
  const routes = [
    known && { route: known[0], playbook: known[1], why: "known game" },
    (!known || known[1] !== playbook || key === "native") && {
      route,
      playbook,
      why: `engine: ${label}`,
    },
    key !== "native" && {
      route: ENGINES.native[2],
      playbook: "native.md",
      why: fallback,
    },
  ].filter(Boolean);
  const w = data.warnings;
  const warnings = [
    ix.files.length < 5 && w.empty,
    anti.length && w.antiCheat.replace("{anti}", anti.join(", ")),
    online && w.online.replace("{name}", online),
    loaders.includes("ScriptHookV") && key.includes("rage") && w.scriptHook,
  ].filter(Boolean);
  return {
    name,
    store: game.store ?? null,
    appid: game.appid ?? null,
    path: root,
    engine: {
      key,
      label,
      confidence: score,
      evidence,
      ...Object.fromEntries(
        Object.entries(det).filter(
          ([, v]) => ![null, undefined, ""].includes(v),
        ),
      ),
    },
    other_engine_signals: hits
      .slice(1, 4)
      .map((h) => ({ key: h.key, evidence: h.evidence })),
    anti_cheat: anti,
    mod_loaders_installed: loaders,
    mod_folders: data.modDirs.filter((d) => ix.dirs.has(d)),
    workshop: game.workshop ?? null,
    saves: saveHints(name, det, folders()),
    executables,
    routes,
    warnings,
    playbook: `skills/mod-any-game/references/engines/${routes[0].playbook}`,
    files_indexed: ix.files.length,
    index_truncated: ix.truncated,
  };
}

export function formatReport(r) {
  const e = r.engine;
  const store = [r.store, r.appid].filter(Boolean).join(" ");
  const extra = Object.entries(e).filter(
    ([k]) => !["key", "label", "confidence", "evidence"].includes(k),
  );
  const exes = Object.entries(r.executables).slice(0, 5);
  return [
    r.name + (r.store ? `  (${store})` : ""),
    `  path:      ${r.path}`,
    `  engine:    ${e.label}  [${e.confidence}%]  evidence: ${e.evidence.join(", ")}`,
    extra.length &&
      `             ${extra.map(([k, v]) => `${k}=${v}`).join(", ")}`,
    r.other_engine_signals.length &&
      `  also:      ${r.other_engine_signals.map((o) => `${o.key} (${o.evidence.slice(0, 1).join(", ")})`).join("; ")}`,
    exes.length &&
      `  exes:      ${exes.map(([k, v]) => `${k} [${v.arch}${v.managed ? ", .NET" : ""}]`).join(", ")}`,
    `  anti-cheat: ${r.anti_cheat.join(", ") || "none found"}`,
    `  loaders:   ${r.mod_loaders_installed.join(", ") || "none installed"}`,
    r.mod_folders.length && `  mod dirs:  ${r.mod_folders.join(", ")}`,
    r.workshop && `  workshop:  ${r.workshop}`,
    r.saves.length && `  saves:     ${r.saves.join("\n             ")}`,
    "  routes:",
    ...r.routes.map(
      (rt, i) =>
        `    ${i + 1}. ${rt.route}  (${rt.why}; read references/engines/${rt.playbook})`,
    ),
    ...r.warnings.map((w) => `  WARNING:   ${w}`),
    r.index_truncated &&
      "  note:      file index truncated (huge install); pass a subfolder for detail",
  ]
    .filter(Boolean)
    .join("\n");
}

function list(json) {
  const games = allGames();
  if (json) return emit(games, true);
  if (!games.length)
    return console.log(
      "no Steam/Epic/Xbox installs found; pass a game folder to `um scan <path>`",
    );
  const lower = (g) => (g.name ?? "").toLowerCase();
  for (const g of games.sort((a, b) => lower(a).localeCompare(lower(b))))
    console.log(
      `${g.store.padEnd(6)} ${String(g.appid ?? "").padStart(10)}  ${g.name}  ->  ${g.path}`,
    );
}

export const commands = {
  default: {
    help,
    usage: "[<game>] [--list] [--json]",
    options: data.options,
    run({ list: listOnly, json }, [game]) {
      if (listOnly) return list(json);
      if (!game) die("give a game name or folder, or use `um scan --list`", 2);
      const r = scan(game);
      emit(json ? r : formatReport(r), json);
    },
  },
};
