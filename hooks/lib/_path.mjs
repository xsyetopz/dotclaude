// Pure path functions for posix and win32. This file imports nothing, so it
// runs in a hooks module that has no Node and no Bun. It ports the logic of
// `lib/path.js` of Node.js (MIT license, Copyright Joyent, Inc. and other
// Node contributors) and gives the results of `node:path` of Bun. A test
// compares it with `node:path`.
//
// Two differences from Bun, both in `resolve`:
// 1. There is no implicit current folder. `resolve` throws an Error when no
//    segment is a root. On posix, a root is a path that starts with `/`. On
//    win32, a root is a drive, a UNC share, or a leading separator. A win32
//    segment such as `\a` has a root but no drive, so `resolve("\\a")`
//    gives `\a`, as Bun does on macOS. Callers pass an absolute base, for
//    example `path.resolve(io.cwd, x)`. `relative` and `toNamespacedPath`
//    call `resolve`, so they need rooted input too.
// 2. On win32, `resolve` does not read the per-drive current folder from the
//    environment. A drive-relative segment such as `D:x` with no absolute
//    base on that drive resolves against the drive root `D:\`.

/** Throw a TypeError when a path argument is not a string. */
function str(value, name = "path") {
  if (typeof value !== "string")
    throw new TypeError(`The "${name}" argument must be a string`);
  return value;
}

/**
 * Remove "." and ".." segments from a path that has no root. The caller
 * passes the separator and a test for separator characters.
 */
function normalizeString(path, allowAboveRoot, separator, isSep) {
  let res = "";
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let code = "";
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) code = path[i];
    else if (isSep(code)) break;
    else code = "/";
    if (isSep(code)) {
      if (lastSlash === i - 1 || dots === 1) {
        // Empty or "." segment: skip.
      } else if (dots === 2) {
        if (res.length < 2 || lastSegmentLength !== 2 || !res.endsWith("..")) {
          if (res.length > 2) {
            const at = res.lastIndexOf(separator);
            res = at === -1 ? "" : res.slice(0, at);
            lastSegmentLength = res.length - 1 - res.lastIndexOf(separator);
            lastSlash = i;
            dots = 0;
            continue;
          }
          if (res.length !== 0) {
            res = "";
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          res += res.length > 0 ? `${separator}..` : "..";
          lastSegmentLength = 2;
        }
      } else {
        const part = path.slice(lastSlash + 1, i);
        res = res.length > 0 ? `${res}${separator}${part}` : part;
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === "." && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

/**
 * Find the last name part and its extension, ignoring the first `start`
 * characters (the root). `part` is the first value of `startPart`. `dot` is
 * -1 when the name has no extension.
 */
function scan(path, start, isSep, part = start) {
  let startDot = -1;
  let startPart = part;
  let end = -1;
  let matchedSlash = true;
  let preDotState = 0;
  for (let i = path.length - 1; i >= start; --i) {
    const c = path[i];
    if (isSep(c)) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (c === ".") {
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }
  const none =
    startDot === -1 ||
    end === -1 ||
    preDotState === 0 ||
    (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1);
  return { startPart, end, dot: none ? -1 : startDot };
}

/** Build the path functions of one platform. */
function make(platform) {
  const win = platform === "win32";
  const sep = win ? "\\" : "/";
  const isSep = win ? (c) => c === "/" || c === "\\" : (c) => c === "/";
  const driveAt = (p) => win && /^[A-Za-z]:/.test(p);

  /**
   * Split the root off a path. `device` is a drive or UNC share, `end` is the
   * length of the root, and `abs` tells if the path is absolute.
   */
  function root(p) {
    if (!isSep(p[0])) {
      if (!driveAt(p)) return { device: "", end: 0, abs: false };
      const abs = isSep(p[2]);
      return { device: p.slice(0, 2), end: abs ? 3 : 2, abs };
    }
    if (win && isSep(p[1])) {
      let j = 2;
      while (j < p.length && !isSep(p[j])) j++;
      let k = j;
      while (k < p.length && isSep(p[k])) k++;
      if (j > 2 && k < p.length) {
        let m = k;
        while (m < p.length && !isSep(p[m])) m++;
        const device = `\\\\${p.slice(2, j)}\\${p.slice(k, m)}`;
        return { device, end: m === p.length ? m : m + 1, abs: true };
      }
    }
    return { device: "", end: 1, abs: true };
  }

  function normalize(p) {
    str(p);
    if (p.length === 0) return ".";
    if (win && p.length === 1) return p === "/" ? "\\" : p;
    const { device, end, abs } = root(p);
    let tail =
      end < p.length ? normalizeString(p.slice(end), !abs, sep, isSep) : "";
    if (tail.length === 0 && !abs) tail = ".";
    if (tail.length > 0 && isSep(p[p.length - 1])) tail += sep;
    return `${device}${abs ? sep : ""}${tail}`;
  }

  function resolve(...args) {
    // Bun checks every segment on win32. On posix it stops at the first root.
    if (win) for (let i = 0; i < args.length; i++) str(args[i], `paths[${i}]`);
    let device = "";
    let tail = "";
    let abs = false;
    for (let i = args.length - 1; i >= 0; i--) {
      const p = str(args[i], `paths[${i}]`);
      if (p.length === 0) continue;
      const r = root(p);
      if (r.device) {
        if (device) {
          if (r.device.toLowerCase() !== device.toLowerCase()) continue;
        } else {
          device = r.device;
        }
      }
      if (abs) {
        if (device) break;
      } else {
        tail = `${p.slice(r.end)}${sep}${tail}`;
        abs = r.abs;
        if (abs && !win) break;
      }
    }
    if (!abs && !device)
      throw new Error(
        "path.resolve has no current folder: pass an absolute base as the first segment",
      );
    return `${device}${sep}${normalizeString(tail, false, sep, isSep)}`;
  }

  function relative(from, to) {
    str(from, "from");
    str(to, "to");
    if (from === to) return "";
    const fromOrig = resolve(from);
    const toOrig = resolve(to);
    if (fromOrig === toOrig) return "";
    const a = win ? fromOrig.toLowerCase() : fromOrig;
    const b = win ? toOrig.toLowerCase() : toOrig;
    if (a === b) return "";
    const bounds = (s) => {
      let start = 0;
      while (start < s.length && s[start] === sep) start++;
      let end = s.length;
      while (end - 1 > start && s[end - 1] === sep) end--;
      return [start, end];
    };
    const [fromStart, fromEnd] = bounds(a);
    let [toStart, toEnd] = bounds(b);
    const fromLen = fromEnd - fromStart;
    const toLen = toEnd - toStart;
    const length = Math.min(fromLen, toLen);
    let lastCommonSep = -1;
    let i = 0;
    for (; i < length; i++) {
      if (a[fromStart + i] !== b[toStart + i]) break;
      if (a[fromStart + i] === sep) lastCommonSep = i;
    }
    if (win && i !== length) {
      if (lastCommonSep === -1) return toOrig;
    } else if (i === length) {
      const rootLen = win ? 2 : 0;
      if (toLen > length) {
        if (b[toStart + i] === sep) return toOrig.slice(toStart + i + 1);
        if (i === rootLen) return toOrig.slice(toStart + i);
      } else if (fromLen > length) {
        if (a[fromStart + i] === sep) lastCommonSep = i;
        else if (i === rootLen) lastCommonSep = win ? 3 : 0;
      }
    }
    let out = "";
    for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i)
      if (i === fromEnd || a[i] === sep)
        out += out.length === 0 ? ".." : `${sep}..`;
    toStart += lastCommonSep;
    if (out.length > 0) {
      // A root without a drive leaves only its separator, as in Node.
      const rest = toOrig.slice(toStart, toEnd);
      return rest === sep ? out : `${out}${rest}`;
    }
    if (toOrig[toStart] === sep) ++toStart;
    return toOrig.slice(toStart, toEnd);
  }

  return {
    sep,
    delimiter: win ? ";" : ":",
    normalize,
    resolve,
    relative,

    isAbsolute: (p) => root(str(p)).abs,

    join(...args) {
      let joined;
      let first = "";
      for (let i = 0; i < args.length; i++) {
        const arg = str(args[i], `paths[${i}]`);
        if (arg.length === 0) continue;
        if (joined === undefined) joined = first = arg;
        else joined += `${sep}${arg}`;
      }
      if (joined === undefined) return ".";
      if (win) {
        // Keep a leading "\\" of a UNC path only when the first part has it.
        let slashes = 0;
        let replace = true;
        if (isSep(first[0])) {
          slashes = 1;
          if (isSep(first[1])) {
            slashes = 2;
            if (first.length > 2 && !isSep(first[2])) replace = false;
          }
        }
        if (replace) {
          while (slashes < joined.length && isSep(joined[slashes])) slashes++;
          if (slashes >= 2) joined = `\\${joined.slice(slashes)}`;
        }
      }
      return normalize(joined);
    },

    toNamespacedPath(p) {
      if (!win || typeof p !== "string" || p.length === 0) return p;
      const r = resolve(p);
      if (r.length <= 2) return p;
      if (r[0] === "\\") {
        if (r[1] === "\\" && r[2] !== "?" && r[2] !== ".")
          return `\\\\?\\UNC\\${r.slice(2)}`;
      } else if (driveAt(r) && r[2] === "\\") {
        return `\\\\?\\${r}`;
      }
      // Bun gives the resolved path for a root that starts with `\\.` or `\\?`.
      return r;
    },

    dirname(p) {
      str(p);
      if (p.length === 0) return ".";
      const rootEnd = root(p).end;
      let end = -1;
      let matchedSlash = true;
      for (let i = p.length - 1; i >= rootEnd; --i) {
        if (isSep(p[i])) {
          if (!matchedSlash) {
            end = i;
            break;
          }
        } else {
          matchedSlash = false;
        }
      }
      if (end === -1) return rootEnd > 0 ? p.slice(0, rootEnd) : ".";
      if (!win && rootEnd === 1 && end === 1) return "//";
      return p.slice(0, end);
    },

    basename(p, suffix) {
      str(p);
      if (suffix !== undefined) str(suffix, "suffix");
      let start = driveAt(p) ? 2 : 0;
      let end = -1;
      let matchedSlash = true;
      if (
        suffix !== undefined &&
        suffix.length > 0 &&
        suffix.length <= p.length
      ) {
        if (suffix === p) return "";
        let extIdx = suffix.length - 1;
        let firstNonSlashEnd = -1;
        for (let i = p.length - 1; i >= start; --i) {
          if (isSep(p[i])) {
            if (!matchedSlash) {
              start = i + 1;
              break;
            }
            continue;
          }
          if (firstNonSlashEnd === -1) {
            matchedSlash = false;
            firstNonSlashEnd = i + 1;
          }
          if (extIdx >= 0) {
            if (p[i] === suffix[extIdx]) {
              if (--extIdx === -1) end = i;
            } else {
              extIdx = -1;
              end = firstNonSlashEnd;
            }
          }
        }
        if (start === end) end = firstNonSlashEnd;
        else if (end === -1) end = p.length;
        return p.slice(start, end);
      }
      for (let i = p.length - 1; i >= start; --i) {
        if (isSep(p[i])) {
          if (!matchedSlash) {
            start = i + 1;
            break;
          }
        } else if (end === -1) {
          matchedSlash = false;
          end = i + 1;
        }
      }
      return end === -1 ? "" : p.slice(start, end);
    },

    extname(p) {
      str(p);
      const { dot, end } = scan(p, driveAt(p) ? 2 : 0, isSep);
      return dot < 0 ? "" : p.slice(dot, end);
    },

    parse(p) {
      str(p);
      const ret = { root: "", dir: "", base: "", ext: "", name: "" };
      if (p.length === 0) return ret;
      const rootEnd = root(p).end;
      ret.root = p.slice(0, rootEnd);
      // Node starts `startPart` at 0 on posix, so "/.." has the extension ".".
      const { startPart, end, dot } = scan(
        p,
        rootEnd,
        isSep,
        win ? rootEnd : 0,
      );
      if (end !== -1) {
        const from = startPart === 0 && rootEnd > 0 ? 1 : startPart;
        ret.base = p.slice(from, end);
        ret.name = dot < 0 ? ret.base : p.slice(from, dot);
        if (dot >= 0) ret.ext = p.slice(dot, end);
      }
      ret.dir =
        startPart > 0 && startPart !== rootEnd
          ? p.slice(0, startPart - 1)
          : ret.root;
      return ret;
    },

    format(obj) {
      if (obj === null || typeof obj !== "object")
        throw new TypeError('The "pathObject" argument must be of type object');
      const dir = obj.dir || obj.root;
      const ext = obj.ext ? `${obj.ext[0] === "." ? "" : "."}${obj.ext}` : "";
      const base = obj.base || `${obj.name || ""}${ext}`;
      if (!dir) return base;
      return dir === obj.root ? `${dir}${base}` : `${dir}${sep}${base}`;
    },
  };
}

/** Path functions with the behavior of `path.posix` of `node:path`. */
export const posix = make("posix");

/** Path functions with the behavior of `path.win32` of `node:path`. */
export const win32 = make("win32");

/**
 * Return the path functions of a platform.
 * @param {"posix" | "win32"} platform
 */
export function pathFor(platform) {
  if (platform === "posix") return posix;
  if (platform === "win32") return win32;
  throw new TypeError(`Unknown platform "${platform}": use "posix" or "win32"`);
}
