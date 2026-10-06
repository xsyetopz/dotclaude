"""Offline test of `um video compile`.

    uv run --with pytest --with pillow --with numpy pytest -q tests/modder/py
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "plugins" / "dotclaude-modder" / "um" / "py"))

import video  # noqa: E402


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg")
def test_compile_small_edl(tmp_path):
    for i in range(2):
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:d=3:r=30", "-f", "lavfi", "-i", "sine=f=440:d=3",
                        "-shortest", str(tmp_path / f"c{i}.mp4")], check=True)
    edl = {"size": [640, 360], "fps": 30, "bpm": 120, "beat_lock": True, "transition": {"type": "cut"},
           "segments": [{"clip": "c0.mp4", "in": 0, "beats": 4, "hook": "Hello"},
                        {"clip": "c1.mp4", "in": 0.5, "beats": 4, "title": "A title", "credit": "@someone", "transition": {"type": "fade", "duration": 0.3}},
                        {"card": {"title": "The end"}, "dur": 1.5}]}
    (tmp_path / "edl.json").write_text(json.dumps(edl))
    video.compile_edl(tmp_path / "edl.json", str(tmp_path / "out.mp4"))
    info = video.probe(tmp_path / "out.mp4")
    assert abs(info["duration"] - (2 + 2 + 1.5)) < 0.15 and info["audio"]
