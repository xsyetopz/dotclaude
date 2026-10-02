// The catalog of open source AI contribution policies, from the table in
// melissawm/open-source-ai-contribution-policies (CC0-1.0).
//
// The plugin ships a snapshot in `_ai-policies.json`. The update script writes
// a newer copy to the plugin data directory, and that copy wins. The upstream
// README hash is fetched at session start in a detached process, at most once
// a day, and never when `DOTCLAUDE_OFFLINE` is set (the tests set it). The
// guard reads only the stored hash.

import { pathFor } from "./_path.mjs";
import { sha1 } from "./_sha1.mjs";

export const UPSTREAM = {
  repo: "melissawm/open-source-ai-contribution-policies",
  path: "README.md",
  branch: "main",
};

const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_S = 3;
// The old `execFileSync` stopped at 1 MiB of output, so the fetch does the same.
const FETCH_MAX_BYTES = 1024 * 1024;

export function dataDir(io) {
  return (
    io.env.CLAUDE_PLUGIN_DATA || pathFor(io.platform).join(io.tmp, "dotclaude")
  );
}

export const userCatalogPath = (io) =>
  pathFor(io.platform).join(dataDir(io), "ai-policies.json");
const checkPath = (io) =>
  pathFor(io.platform).join(dataDir(io), "ai-policies-upstream.json");
// The plugin ships the catalog snapshot next to this file.
const shippedPath = (io) =>
  pathFor(io.platform).join(io.pluginRoot, "hooks", "lib", "_ai-policies.json");

// --- parsing ----------------------------------------------------------------

const LINK = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/;
const REPO_HOSTS = new Set(["github.com", "codeberg.org", "git.sr.ht"]);
// Repositories that hold an organization-wide policy, not one project.
const ORG_REPOS = new Set([".github", ".profile", "governance", "community"]);

// Projects whose table links point to a website, mapped to their forge
// repositories (each checked to exist). A URL with one path part stands for
// the whole organization.
export const KNOWN_REPOS = {
  "Asahi Linux": ["https://github.com/AsahiLinux"],
  Bevy: ["https://github.com/bevyengine/bevy"],
  Borgmatic: [
    "https://projects.torsion.org/borgmatic-collective/borgmatic",
    "https://github.com/borgmatic-collective/borgmatic",
  ],
  "CC Open Source": ["https://github.com/creativecommons"],
  chezmoi: ["https://github.com/twpayne/chezmoi"],
  "Chimera Linux": ["https://github.com/chimera-linux"],
  Clojure: ["https://github.com/clojure/clojure"],
  "Elementary OS": ["https://github.com/elementary"],
  "Gentoo Linux": ["https://github.com/gentoo/gentoo"],
  "Glasgow Interface Explorer": ["https://github.com/GlasgowEmbedded/glasgow"],
  Inkscape: ["https://gitlab.com/inkscape/inkscape"],
  Iocaine: ["https://git.madhouse-project.org/iocaine/iocaine"],
  Krita: ["https://invent.kde.org/graphics/krita"],
  OpenJDK: ["https://github.com/openjdk"],
  Pallets: ["https://github.com/pallets"],
  postmarketOS: ["https://gitlab.postmarketos.org/postmarketOS"],
  QEMU: [
    "https://gitlab.com/qemu-project/qemu",
    "https://github.com/qemu/qemu",
  ],
  Servo: ["https://github.com/servo/servo"],
  Twisted: ["https://github.com/twisted/twisted"],
  Unbound: ["https://github.com/NLnetLabs/unbound"],
  "Vim Classic": ["https://git.sr.ht/~sircmpwn/vim-classic"],
  Zig: ["https://codeberg.org/ziglang/zig", "https://github.com/ziglang/zig"],
};

/**
 * `host/owner/repo` (or `host/owner` for an organization) of a forge URL,
 * lowercase. Undefined for a plain website, unless `anyHost` is set: then
 * every path is a repository path, as in a git remote URL.
 */
export function repoKey(url, anyHost = false) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const segs = u.pathname
    .split("/")
    .filter(Boolean)
    .map((s) => s.toLowerCase());
  if (REPO_HOSTS.has(host)) {
    if (!segs.length) return undefined;
    const repo = segs[1]?.replace(/\.git$/, "");
    if (!repo || ORG_REPOS.has(repo)) return `${host}/${segs[0]}`;
    return `${host}/${segs[0]}/${repo}`;
  }
  if (anyHost || /^(gitlab|invent)\./.test(host)) {
    // GitLab ends the project path at `/-/`, Gitea and Forgejo at `/src/`.
    let cut = segs.findIndex((s) => s === "-" || s === "src");
    if (cut === -1) cut = segs.length;
    const project = segs
      .slice(0, cut)
      .join("/")
      .replace(/\.git$/, "");
    return project ? `${host}/${project}` : undefined;
  }
  return undefined;
}

/** Key of a git remote URL (https, ssh, or scp-like), or undefined. */
export function remoteKey(remote) {
  const s = String(remote ?? "").trim();
  const scp = /^[\w.-]+@([\w.-]+):(?!\/)(.+)$/.exec(s);
  const url = scp ? `https://${scp[1]}/${scp[2]}` : s.replace(/^git\+/, "");
  const key = repoKey(
    url.replace(/^ssh:\/\/([^@/]+@)?([^/:]+)(:\d+)?/, "https://$2"),
    true,
  );
  return key && key.split("/").length >= 3 ? key : undefined;
}

const cells = (row) =>
  row
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());

/** Parse the upstream README table into catalog entries. */
export function parseReadme(markdown) {
  const lines = markdown.split("\n");
  const head = lines.findIndex((l) => /^\s*\|?\s*Project\s*\|/i.test(l));
  if (head === -1) throw new Error("no policy table in the README");
  const columns = cells(lines[head]).map((c) => c.toLowerCase());
  const col = (word) => columns.findIndex((c) => c.includes(word));
  const at = {
    project: col("project"),
    policy: col("policy link"),
    allowed: col("allowed"),
    disclosure: col("disclosure"),
    human: col("human"),
    notes: col("notes"),
  };
  const entries = [];
  for (const line of lines.slice(head + 2)) {
    if (!line.includes("|")) break;
    const row = cells(line);
    const project = LINK.exec(row[at.project] ?? "");
    const policy = LINK.exec(row[at.policy] ?? "");
    const name = project?.[1] ?? row[at.project];
    const keys = [project?.[2], policy?.[2]]
      .map((url) => repoKey(url))
      .concat((KNOWN_REPOS[name] ?? []).map((url) => repoKey(url, true)))
      .filter(Boolean);
    entries.push({
      project: name,
      allowed: row[at.allowed] ?? "?",
      disclosure: row[at.disclosure] ?? "-",
      human: row[at.human] ?? "-",
      policy: policy?.[2] ?? project?.[2] ?? "",
      notes: (row[at.notes] ?? "").replace(/^-$/, ""),
      keys: [...new Set(keys)],
    });
  }
  return entries;
}

// --- loading and matching ---------------------------------------------------

let cached;

/** The newest catalog: the updated copy in the data directory, else the shipped one. */
export async function loadCatalog(io) {
  if (cached) return cached;
  for (const file of [userCatalogPath(io), shippedPath(io)]) {
    try {
      const catalog = JSON.parse(await io.fs.read(file));
      if (Array.isArray(catalog.entries)) {
        cached = { ...catalog, file };
        return cached;
      }
    } catch {
      // missing or damaged: try the next one
    }
  }
  cached = { sha: null, entries: [], file: null };
  return cached;
}

export function resetCatalogCache() {
  cached = undefined;
}

/** True when the entry forbids AI contributions ("No", "No*"). */
export const forbids = (entry) => /^no\b/i.test(entry.allowed);

/** Catalog entry for a repository key: an exact match, else its owner. */
export async function lookup(io, key) {
  if (!key) return undefined;
  const owner = key.split("/").slice(0, 2).join("/");
  const { entries } = await loadCatalog(io);
  return (
    entries.find((e) => e.keys.includes(key)) ??
    entries.find((e) => e.keys.includes(owner))
  );
}

// --- the upstream check ----------------------------------------------------

export const RAW_URL = `https://raw.githubusercontent.com/${UPSTREAM.repo}/${UPSTREAM.branch}/${UPSTREAM.path}`;

/** The git blob hash of `text`, the same value GitHub reports as `sha`. */
export function blobSha(text) {
  const body = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`blob ${body.length}\0`);
  const blob = new Uint8Array(head.length + body.length);
  blob.set(head);
  blob.set(body, head.length);
  return sha1(blob);
}

// The raw file host has no API rate limit, so the hash is computed locally.
async function fetchUpstreamSha(io) {
  const r = await io.run(
    ["curl", "-fsSL", "--max-time", String(FETCH_TIMEOUT_S), RAW_URL],
    { timeoutMs: (FETCH_TIMEOUT_S + 1) * 1000, maxBytes: FETCH_MAX_BYTES },
  );
  if (r.exitCode !== 0) throw new Error(`curl exited with ${r.exitCode}`);
  return r.stdout.includes("|") ? blobSha(r.stdout) : undefined;
}

async function readState(io) {
  try {
    return JSON.parse(await io.fs.read(checkPath(io)));
  } catch {
    return {}; // never checked
  }
}

/** True when the upstream hash is older than a day and the check is on. */
export async function upstreamStale(io, now = Date.now()) {
  if (io.env.DOTCLAUDE_OFFLINE) return false;
  return !(now - ((await readState(io)).checked ?? 0) < CHECK_EVERY_MS);
}

/**
 * Fetch the upstream README hash and store it, at most once a day and never
 * offline. The SessionStart hook runs this in a detached process, so a slow
 * network never holds a tool call.
 */
export async function refreshUpstream(
  io,
  now = Date.now(),
  fetchSha = () => fetchUpstreamSha(io),
) {
  if (!(await upstreamStale(io, now))) return;
  let sha;
  try {
    sha = await fetchSha();
  } catch {
    // offline or rate limited: keep the last answer until the next day
  }
  const state = { checked: now, sha: sha ?? (await readState(io)).sha ?? null };
  try {
    await io.fs.write(checkPath(io), JSON.stringify(state));
  } catch {
    // a read-only data directory only repeats the check
  }
}

/**
 * The stored upstream README hash when it differs from the catalog in use,
 * else undefined. Reads only the file that `refreshUpstream` writes.
 */
export async function upstreamChange(io) {
  if (io.env.DOTCLAUDE_OFFLINE) return undefined;
  const { sha } = await readState(io);
  const current = (await loadCatalog(io)).sha;
  return sha && current && sha !== current ? sha : undefined;
}

/** A sentence for the user when the upstream catalog changed, else "". */
export async function updateNotice(io) {
  if (!(await upstreamChange(io))) return "";
  const script = pathFor(io.platform).join(
    io.pluginRoot,
    "scripts",
    "update-ai-policies.mjs",
  );
  return ` The upstream AI policy list changed after this catalog was made. To update the catalog, run \`bun ${script}\`.`;
}
