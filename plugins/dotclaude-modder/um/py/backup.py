# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Snapshot folders before you touch them (saves, profiles, config, the game data folder).

    um backup create "C:\\Users\\me\\Documents\\My Games\\Terraria" --name terraria-saves
    um backup list [name]
    um backup diff terraria-saves "C:\\Users\\me\\Documents\\My Games\\Terraria"
    um backup restore terraria-saves [--to DIR] [--snapshot FILE] [--yes]

A snapshot is a zip file and a manifest (size and sha1 of each file) in ~/.universal-modder/backups/<name>/.
`restore` first takes a snapshot of the current state, so you can undo a restore, and then puts every file back.
It removes the files that were not in the snapshot only with --clean.
Keep a pristine copy of each world or scenario that a scripted take destroys, and restore it before each take.
"""

import argparse
import hashlib
import json
import sys
import time
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import data_dir, die, to_posix  # noqa: E402

def _root(name: str) -> Path:
    # The folder must stay in backups/, also on Windows, which removes a dot or a space at the end of a name.
    if not name.strip(".") or name != name.rstrip(". ") or any(c in name for c in "/\\:\0"):
        die(f"bad snapshot name {name!r}: use no / \\ :, no dot or space at the end, and not only dots")
    (d := data_dir() / "backups" / name).mkdir(parents=True, exist_ok=True)
    return d


def _scan(src: Path) -> dict:
    files = {}
    for p in sorted(src.rglob("*")):
        if p.is_file():
            h = hashlib.sha1()
            with open(p, "rb") as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    h.update(chunk)
            files[p.relative_to(src).as_posix()] = dict(size=p.stat().st_size, sha1=h.hexdigest())
    return files


def create(src: str, name: str | None = None, note: str = "") -> Path:
    s = Path(to_posix(src)).expanduser()
    if not s.is_dir():
        die(f"not a folder: {s}")
    name = name or s.resolve().name.replace(" ", "-").lower()
    files = _scan(s)
    total = sum(f["size"] for f in files.values())
    if total > 20 << 30:
        die(f"{total / 2**30:.1f} GB - too big to snapshot casually; back up the specific subfolder you'll change")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    # Same-second snapshots get a suffix (`_` sorts after `.`), and mode "x" never overwrites.
    out = next(p for n in range(100) if not any((p := _root(name) / f"{stamp}{f'_{n:02d}' if n else ''}.zip").with_suffix(s).exists() for s in (".zip", ".part")))
    # strict_timestamps=False: some folders hold pre-1980 mtimes.
    with open(part := out.with_suffix(".part"), "xb") as fh, zipfile.ZipFile(fh, "w", zipfile.ZIP_DEFLATED, compresslevel=6, strict_timestamps=False) as z:
        z.writestr("_um_manifest.json", json.dumps(dict(source=str(src), created=stamp, note=note, files=files), indent=1))
        for rel in files:
            z.write(s / rel, rel)
    part.rename(out)  # a failed create leaves a .part file, which is not a snapshot
    print(f"{out}  ({len(files)} files, {total / 2**20:.1f} MB)")
    return out


def snapshots(name: str) -> list[Path]:
    return sorted(_root(name).glob("*.zip"))


def manifest(zp: Path, full: bool = False) -> dict:
    try:
        with zipfile.ZipFile(zp) as z:
            m = json.loads(z.read("_um_manifest.json"))
            if full and (z.testzip() or set(m["files"]) - set(z.namelist())):  # a bad CRC or a lost file
                raise zipfile.BadZipFile("a file is damaged or missing")
            return m
    except (OSError, KeyError, TypeError, ValueError, zipfile.BadZipFile) as e:
        die(f"cannot read the snapshot {zp}: {e!r}")


def diff(name: str, target: str | None = None, snapshot: str | None = None) -> dict:
    zp = Path(snapshot) if snapshot else (snapshots(name) or die(f"no snapshots for {name}"))[-1]
    m = manifest(zp)
    t = Path(to_posix(target or m["source"]))
    now = _scan(t) if t.is_dir() else {}
    old = m["files"]
    return dict(snapshot=str(zp), target=str(t),
                added=sorted(set(now) - set(old)), removed=sorted(set(old) - set(now)),
                changed=sorted(k for k in set(now) & set(old) if now[k]["sha1"] != old[k]["sha1"]))


def restore(name: str, to: str | None = None, snapshot: str | None = None, clean: bool = False, yes: bool = False):
    d = diff(name, to, snapshot)
    zp, t = Path(d["snapshot"]), Path(d["target"])
    m = manifest(zp, full=True)  # check the whole zip before the restore changes a file
    print(f"restore {zp.name} -> {t}: {len(d['changed'])} changed, {len(d['removed'])} missing, {len(d['added'])} new since"
          + (" (new files will be deleted: --clean)" if clean else " (new files kept)"))
    if not yes:
        die("re-run with --yes to do it")
    if t.is_dir():
        create(str(t), name + "-pre-restore", note=f"automatic, before restoring {zp.name}")
    with zipfile.ZipFile(zp) as z:  # extractall makes the folders
        z.extractall(t, m["files"])
    for rel in d["added"] if clean else []:
        (t / rel).unlink(missing_ok=True)
    print("restored", len(m["files"]), "files")


def main(a):
    match a.cmd:
        case "create":
            create(a.src, a.name, a.note or "")
        case "list":
            root = data_dir() / "backups"
            names = [a.name] if a.name else sorted(p.name for p in root.glob("*") if p.is_dir())
            for n in names:
                for zp in snapshots(n):
                    m = manifest(zp)
                    print(f"{n:28} {zp.name}  {len(m['files']):5} files  {m['source']}  {m.get('note', '')}")
        case "diff":
            print(json.dumps(diff(a.name, a.target, a.snapshot), indent=1))
        case "restore":
            restore(a.name, a.to, a.snapshot, a.clean, a.yes)


def parser():
    p = argparse.ArgumentParser(prog="um backup", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    cs = p.add_subparsers(dest="cmd", metavar="<cmd>", required=True)
    q = cs.add_parser("create", help="snapshot a folder")
    for arg in ("src", "--name", "--note"):
        q.add_argument(arg)
    cs.add_parser("list", help="list snapshots").add_argument("name", nargs="?")
    q = cs.add_parser("diff", help="what changed since the latest snapshot")
    q.add_argument("name")
    q.add_argument("target", nargs="?")
    q.add_argument("--snapshot")
    q = cs.add_parser("restore", help="restore the latest (or --snapshot) snapshot")
    for arg in ("name", "--to", "--snapshot"):
        q.add_argument(arg)
    q.add_argument("--clean", action="store_true", help="also delete files created after the snapshot")
    q.add_argument("--yes", action="store_true")
    return p


if __name__ == "__main__":
    main(parser().parse_args())
