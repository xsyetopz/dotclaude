"""The helpers that the Python groups share. A part of `um/common.py` from universal-modder."""
from __future__ import annotations

import os
import platform
import sys
from pathlib import Path
from typing import NoReturn


def data_dir() -> Path:
    return Path(os.environ.get("UM_HOME") or Path.home() / ".universal-modder")


def to_posix(p: str) -> str:
    """'C:\\x' -> '/mnt/c/x' under WSL."""
    wsl = sys.platform == "linux" and ("microsoft" in platform.release().lower()
                                       or Path("/proc/sys/fs/binfmt_misc/WSLInterop").exists())
    return f"/mnt/{p[0].lower()}{p[2:].replace(chr(92), '/')}" if wsl and p[1:2] == ":" else p


def die(msg: str, code: int = 1) -> NoReturn:
    print(f"um: {msg}", file=sys.stderr)
    sys.exit(code)


def parse_size(s: str) -> tuple[int, int]:
    """'64x26' -> (64, 26); '128' -> (128, 128)."""
    w, _, h = s.lower().partition("x")
    try:
        return int(w), int(h or w)
    except ValueError:
        die(f"not a size: {s}")


def need(module: str, pip_name: str | None = None):
    try:
        return __import__(module)
    except ImportError:
        die(f"this command needs {pip_name or module}: install uv (https://docs.astral.sh/uv/), "
            f"or run `pip install {pip_name or module}`")
