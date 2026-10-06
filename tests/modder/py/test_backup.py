"""The cases of `tests/modder/backup.test.mjs` for `um/py/backup.py`."""
import json
import os
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[3] / "plugins" / "dotclaude-modder" / "um" / "py"))
import backup  # noqa: E402


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("UM_HOME", str(tmp_path / "home"))


def make(d: Path, files: dict):
    for rel, data in files.items():
        (d / rel).parent.mkdir(parents=True, exist_ok=True)
        (d / rel).write_text(data)


def test_backup_handles_pre_1980_timestamps(tmp_path):
    src = tmp_path / "src"
    make(src, {"old.txt": "from 1970", "new.txt": "fresh"})
    os.utime(src / "old.txt", (0, 0))
    zp = backup.create(str(src), "t")
    assert set(backup.manifest(zp)["files"]) == {"old.txt", "new.txt"}


def test_backup_in_the_same_second_keeps_both(tmp_path, monkeypatch):
    monkeypatch.setattr(backup.time, "strftime", lambda _fmt: "20260101-000000")
    src = tmp_path / "src"
    make(src, {"save.dat": "before the mod"})
    first = backup.create(str(src), "t")
    make(src, {"save.dat": "after the mod"})
    second = backup.create(str(src), "t")
    assert backup.snapshots("t") == [first, second]
    assert backup.manifest(first)["files"] != backup.manifest(second)["files"]


@pytest.mark.parametrize("name", ["../x", "a/../../x", "a\\b", "..", ".", "C:x", ".. ", "x.", "x "])
def test_backup_name_must_stay_in_the_backups_folder(tmp_path, capsys, name):
    src = tmp_path / "src"
    make(src, {"save.dat": "v1"})
    with pytest.raises(SystemExit):
        backup.create(str(src), name)
    assert "bad snapshot name" in capsys.readouterr().err
    with pytest.raises(SystemExit):
        backup.snapshots(name)
    assert [p.name for p in (tmp_path / "home").glob("*")] == []


def test_backup_dot_folder_keeps_its_name(tmp_path):
    src = tmp_path / ".minecraft"
    make(src, {"save.dat": "v1"})
    assert backup.create(str(src)).parent.name == ".minecraft"


def test_backup_failed_create_is_not_the_latest_snapshot(tmp_path, monkeypatch):
    src = tmp_path / "src"
    make(src, {"save.dat": "v1"})
    first = backup.create(str(src), "t")
    make(src, {"save.dat": "v2"})
    monkeypatch.setattr(backup.time, "strftime", lambda _fmt: "29990101-000000")
    monkeypatch.setattr(zipfile.ZipFile, "write", lambda *_a, **_k: (_ for _ in ()).throw(OSError("disk full")))
    with pytest.raises(OSError):
        backup.create(str(src), "t")
    assert backup.snapshots("t") == [first]
    monkeypatch.undo()
    monkeypatch.setenv("UM_HOME", str(tmp_path / "home"))
    monkeypatch.setattr(backup.time, "strftime", lambda _fmt: "29990101-000000")
    # A rerun in the same second does not reuse the name of the leftover .part file.
    assert backup.create(str(src), "t").name == "29990101-000000_01.zip"


def damage(zp: Path, how: str):
    data = bytearray(zp.read_bytes())
    if how == "garbage":
        data = b"not a zip file"
    else:  # flip the stored bytes of save.dat, so that its CRC fails
        i = data.index(b"v1-original")
        data[i:i + 2] = b"XX"
    zp.write_bytes(bytes(data))


@pytest.mark.parametrize("how", ["garbage", "crc"])
def test_backup_damaged_snapshot_stops_before_restore(tmp_path, capsys, how):
    src = tmp_path / "src"
    make(src, {"save.dat": "v1-original"})
    zp = backup.create(str(src), "t")
    if how == "crc":  # stored, not deflated, so that the test can find the bytes
        zp.unlink()
        with zipfile.ZipFile(zp, "w") as z:
            z.writestr("_um_manifest.json", json.dumps(dict(source=str(src), files=backup._scan(src))))
            z.writestr("save.dat", "v1-original")
    damage(zp, how)
    (src / "save.dat").write_text("v2")
    with pytest.raises(SystemExit):
        backup.restore("t", to=str(src), yes=True)
    assert "cannot read the snapshot" in capsys.readouterr().err
    assert (src / "save.dat").read_text() == "v2"
    assert not (tmp_path / "home" / "backups" / "t-pre-restore").exists()


def test_backup_diff_and_restore_round_trip(tmp_path):
    src = tmp_path / "src"
    make(src, {"save.dat": "v1", "sub/cfg.ini": "a=1"})
    backup.create(str(src), "t")
    (src / "save.dat").write_text("v2")
    (src / "sub" / "cfg.ini").unlink()
    make(src, {"extra.log": "new"})
    d = backup.diff("t", str(src))
    assert [d["changed"], d["removed"], d["added"]] == [["save.dat"], ["sub/cfg.ini"], ["extra.log"]]
    # No --yes: report only, touch nothing.
    with pytest.raises(SystemExit):
        backup.restore("t", to=str(src))
    assert (src / "save.dat").read_text() == "v2"
    backup.restore("t", to=str(src), clean=True, yes=True)
    assert (src / "save.dat").read_text() == "v1"
    assert (src / "sub" / "cfg.ini").read_text() == "a=1"
    assert not (src / "extra.log").exists()
    # The state before the restore stays as a snapshot.
    assert len(backup.snapshots("t-pre-restore")) == 1
    # A restore to a new folder makes the folder.
    backup.restore("t", to=str(tmp_path / "new" / "dir"), yes=True)
    assert (tmp_path / "new" / "dir" / "sub" / "cfg.ini").read_text() == "a=1"
