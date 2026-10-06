// A port of `um/publish.py` from universal-modder.
// `data/publish.json` has the help text, the secret and decompiler patterns, the extension lists and the messages.

import fs from "node:fs";
import path from "node:path";
import { die, toPosix } from "./common.mjs";
import data from "./data/publish.json" with { type: "json" };

const M = data.messages;
const rxs = (list) =>
  list.map(([label, src, flags]) => [label, new RegExp(src, flags)]);
const exts = (s) => new Set(s.split(/\s+/));
const [CODE_EXT, ARCHIVE_EXT, SKIP_DIRS] = ["code", "archive", "skip"].map(
  (k) => exts(data.ext[k]),
);
const TEXT_EXT = exts(`${data.ext.code} ${data.ext.text}`);
const USER_PATH = new RegExp(...data.userPath);

export const help = data.help.join("\n");
export const SECRET_PATTERNS = rxs(data.secrets);
export const DECOMP_PATTERNS = rxs(data.decomp);

async function sha1(p) {
  const h = new Bun.CryptoHasher("sha1");
  for await (const chunk of Bun.file(p).stream()) h.update(chunk);
  return h.digest("hex");
}

/** Relative paths (with `/`) of the files under `dir`. */
const walk = (dir) =>
  [...new Bun.Glob("**/*").scanSync({ cwd: dir, dot: true })].map((r) =>
    r.replaceAll("\\", "/"),
  );
const sizeOf = (dir, rel) => fs.statSync(path.join(dir, rel)).size;
const readText = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");

export async function check(mod, game) {
  const dir = toPosix(mod);
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory())
    die(M.notFolder + dir);
  const [fails, warns] = [[], []];
  const files = [];
  for (const r of walk(dir)) {
    if (r.split("/").slice(0, -1).some(SKIP_DIRS.has, SKIP_DIRS)) continue;
    // An unreadable file must not stop the lint.
    try {
      fs.accessSync(path.join(dir, r), fs.constants.R_OK);
      files.push(r);
    } catch {
      warns.push(`cannot read ${r} - check it by hand`);
    }
  }
  // Game files: match by size, then by hash.
  const g = game && toPosix(game);
  const bySize = Map.groupBy(g && fs.existsSync(g) ? walk(g) : [], (r) =>
    sizeOf(g, r),
  );
  for (const rel of files) {
    const size = sizeOf(dir, rel);
    if (size < 64 || !bySize.has(size)) continue;
    const h = await sha1(path.join(dir, rel));
    for (const grel of bySize.get(size))
      if ((await sha1(path.join(g, grel))) === h) {
        fails.push(`game file copied verbatim: ${rel}  (== ${grel})`);
        break;
      }
  }
  for (const rel of files) {
    const name = path.basename(rel);
    const ext = path.extname(name).toLowerCase() || name;
    const size = sizeOf(dir, rel);
    if (name.endsWith(".env")) fails.push(`env file (secrets?): ${rel}`);
    if (ARCHIVE_EXT.has(ext) && size > 5 << 20)
      warns.push(
        `large engine archive (${size >> 20} MB): ${rel} - make sure it holds only your own assets`,
      );
    if (!TEXT_EXT.has(ext)) continue;
    const txt = readText(dir, rel);
    for (const [label, rx] of SECRET_PATTERNS)
      if (rx.test(txt)) fails.push(`${label} in ${rel}`);
    for (const [label, rx] of CODE_EXT.has(ext) ? DECOMP_PATTERNS : []) {
      const m = txt.match(rx);
      if (m)
        warns.push(`${label} x${m.length} in ${rel} (e.g. '${m[0].trim()}')`);
    }
    if (USER_PATH.test(txt)) warns.push(`absolute user path in ${rel}`);
  }
  const names = files.map((r) => path.basename(r));
  if (!names.some((n) => n.toLowerCase().startsWith("readme")))
    warns.push(M.noReadme);
  const credited = (r) =>
    /^(readme|credits)/i.test(path.basename(r)) &&
    readText(dir, r).toLowerCase().includes("fal");
  if (names.includes("fal_manifest.jsonl") && !files.some(credited))
    warns.push(M.noCredit);
  for (const x of fails) console.log("FAIL ", x);
  for (const x of warns) console.log("WARN ", x);
  const verdict = fails.length ? "FAIL" : warns.length ? "WARN" : "PASS";
  console.log(
    `${verdict}: ${files.length} files, ${fails.length} failures, ${warns.length} warnings`,
  );
  return fails.length ? 1 : 0;
}

export const commands = {
  check: {
    ...data.command,
    async run({ game }, [mod]) {
      if (!mod) die(M.checkNeedsMod, 2);
      if (await check(mod, game)) die(M.failed);
    },
  },
};
