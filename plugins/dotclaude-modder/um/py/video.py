# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10", "numpy>=1.24"]
# ///
"""Showcase videos: pick moments, cut, title, transition, score, export. ffmpeg and Pillow only.

    um video probe clip.mp4                              # duration, size, fps, audio
    um video contact clip.mp4 sheet.png --every 2        # timestamped grid of frames: look, then choose in and out points
    um video first-frame take.mkv                        # first real gameplay frame (skips dark and flat loading screens)
    um video beats music.mp3                             # tempo and first beat, to cut on the beat
    um video mux take.mkv take.audio.raw take.json out.mp4   # recorder output to mp4 (see `um win record`)
    um video compile edl.json out.mp4 [--preview]        # the edit, described as JSON (below)

EDL (edit decision list) - every key but "segments" is optional:
  {"size": [1920, 1080], "fps": 30, "bpm": 128,
   "theme": {"accent": "#B6FF3B", "text": "#FFFFFF", "chip": "#0A0D12E0"},
   "transition": {"type": "fade", "duration": 0.3},        # any ffmpeg xfade type, or "cut"
   "clip_volume": 0.6, "music": {"path": "track.mp3", "volume": 0.8, "start": 0, "fade_in": 0.2},
   "watermark": {"path": "logo.png", "height": 54, "corner": "br", "opacity": 0.9},
   "counter": false, "fade_out": 0.8, "beat_lock": true, "normalize_audio": true,
   "sfx": [{"path": "whoosh.mp3", "at": 12.5, "volume": 0.8}],
   "segments": [
     {"card": {"title": "Every game is moddable now.", "sub": "", "bg": "#05070A", "logo": "logo.png"}, "dur": 2.2},
     {"clip": "a.mp4", "in": 12.0, "dur": 4.0, "title": "Minecraft inside Elden Ring", "credit": "@TobynJacobs",
      "fill": "blur", "volume": 0.6, "speed": 1.0, "zoom": 1.0, "crop": [0, 0, 1920, 1080], "transition": {"type": "pixelize"}},
     {"clip": "b.mp4", "in": 0, "beats": 8, "hook": "Point Claude at any game."}]}
  "dur" is seconds, or give "beats" with a top-level "bpm" (and "beat_lock", so cuts land on the grid despite transitions).
  "fill": blur | crop | pad for clips that are not 16:9. "watermark": false on a segment hides the logo there.
  Titles are one line, bottom-left, and slide in after the transition. A "credit" sits on the same line.

Style that works on X: open on the strongest moment (2-3 s or less before real gameplay), one-line titles,
3-5 s per clip, credit each creator whose footage you use, end on the name or URL, fade out.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from common import die, need

FONTS = Path(__file__).resolve().parent.parent / "fonts"
TITLE_FONT = FONTS / "SpaceGrotesk-Bold.ttf"
BODY_FONT = FONTS / "SpaceGrotesk-Medium.ttf"
MONO_FONT = FONTS / "JetBrainsMono-Bold.ttf"


def ff(*args):
    cmd = ["ffmpeg", "-hide_banner", "-y", "-loglevel", "error", *map(str, args)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        die("ffmpeg failed:\n" + " ".join(cmd)[:3000] + "\n" + r.stderr[-3000:])


def _probe_ffmpeg(path) -> dict:
    """The fallback without ffprobe: parse the banner of `ffmpeg -i`."""
    err = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path)], capture_output=True, text=True).stderr
    if "Invalid data" in err or "No such file" in err:
        die(f"cannot read {path}: {err.strip().splitlines()[-1]}")
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err)
    dur = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else 0.0
    v = re.search(r"Stream #\S+.*Video: .*?(\d{2,5})x(\d{2,5})", err)
    fps = re.search(r"([\d.]+) fps", err)
    a = re.search(r"Stream #\S+.*Audio: .*?(\d+) Hz", err)
    return dict(path=str(path), duration=dur, width=int(v.group(1)) if v else None, height=int(v.group(2)) if v else None,
                fps=float(fps.group(1)) if fps else None, audio=bool(a), audio_rate=int(a.group(1)) if a else None)


def probe(path) -> dict:
    if not shutil.which("ffprobe"):
        return _probe_ffmpeg(path)
    r = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)], capture_output=True, text=True)
    if r.returncode:
        die(f"ffprobe {path}: {r.stderr.strip()}")
    d = json.loads(r.stdout)
    v = next((s for s in d["streams"] if s["codec_type"] == "video"), {})
    a = next((s for s in d["streams"] if s["codec_type"] == "audio"), None)
    num, den = (v.get("avg_frame_rate") or "0/1").split("/")
    return dict(path=str(path), duration=float(d["format"].get("duration") or v.get("duration") or 0), width=v.get("width"), height=v.get("height"),
                fps=round(float(num) / float(den), 3) if float(den) else None, audio=bool(a), audio_rate=int(a["sample_rate"]) if a else None)


# --------------------------------------------------------------------------- look at footage


def contact(path, out, every=2.0, cols=6, width=320, start=0.0, end=None):
    """A grid of frames with timestamps, so an agent (or you) can choose in and out points by looking."""
    need("PIL", "pillow")
    from PIL import Image, ImageDraw, ImageFont
    info = probe(path)
    end = min(end or info["duration"], info["duration"])
    h = round(width * (info["height"] or 9) / (info["width"] or 16) / 2) * 2
    with tempfile.TemporaryDirectory(prefix="um_contact_") as tmp:
        tmp = Path(tmp)
        # one decoding pass for a short span, and one seek for each frame in a long video
        if (end - start) / every <= 240 and (end - start) <= 600:
            ff("-ss", f"{start:.3f}", "-t", f"{end - start:.3f}", "-i", path, "-vf", f"fps=1/{every},scale={width}:{h}", tmp / "%04d.png")
            tiles = [(start + k * every, Image.open(p).convert("RGB")) for k, p in enumerate(sorted(tmp.glob("*.png"))) if start + k * every <= end]
        else:
            tiles = []
            for i, t in enumerate(frange(start, end - 0.05, every)):
                p = tmp / f"{i:04d}.png"
                ff("-ss", f"{t:.3f}", "-i", path, "-frames:v", "1", "-vf", f"scale={width}:{h}", p)
                if p.exists():
                    tiles.append((t, Image.open(p).convert("RGB")))
    if not tiles:
        die("no frames extracted")
    rows = -(-len(tiles) // cols)
    sheet = Image.new("RGB", (cols * width, rows * (h + 22)), (12, 14, 18))
    dr = ImageDraw.Draw(sheet)
    font = ImageFont.truetype(str(MONO_FONT), 15)
    for i, (t, im) in enumerate(tiles):
        x, y = (i % cols) * width, (i // cols) * (h + 22)
        sheet.paste(im, (x, y + 22))
        dr.text((x + 6, y + 3), f"{t:6.1f}s", fill=(182, 255, 59), font=font)
    sheet.save(out)
    print(out, f"{len(tiles)} frames, {start:.1f}-{end:.1f}s every {every}s")


def frange(a, b, step):
    t = a
    while t <= b + 1e-9:
        yield round(t, 3)
        t += step


def first_frame(path, start=0.0, step=0.5, limit=90, min_mean=45, min_std=18) -> float:
    """Loading screens are dark and flat, and gameplay is not. Returns the first bright, busy frame (seconds)."""
    np = need("numpy")
    t = start
    while t < limit:
        raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", str(path), "-frames:v", "1", "-vf", "scale=160:90,format=gray",
                              "-f", "rawvideo", "-"], capture_output=True).stdout
        if not raw:
            break
        a = np.frombuffer(raw, np.uint8).reshape(-1, 160)[5:-5, 20:140].astype(float)
        if a.mean() > min_mean and a.std() > min_std:
            return t
        t += step
    return 0.0


def beats(path) -> dict:
    """Rough tempo and first-beat offset from the onset strength (good enough to cut on the beat)."""
    np = need("numpy")
    sr = 22050
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"], capture_output=True).stdout
    x = np.frombuffer(raw, np.float32)
    if x.size < sr:
        die("audio too short")
    hop, win = 512, 1024
    frames = np.lib.stride_tricks.sliding_window_view(x, win)[::hop]   # a view: no copy of the overlapping windows
    flux, prev = [], None
    for i in range(0, len(frames), 1024):   # chunks keep the spectrum table small for long tracks
        mag = np.log1p(np.abs(np.fft.rfft(frames[i:i + 1024] * np.hanning(win), axis=1)))
        flux.append(np.maximum(np.diff(mag if prev is None else np.vstack((prev, mag)), axis=0), 0).sum(1))
        prev = mag[-1:]
    flux = np.concatenate(flux)
    flux = (flux - flux.mean()) / (flux.std() + 1e-9)
    fps = sr / hop
    ac = np.fft.irfft(np.abs(np.fft.rfft(flux, 2 * flux.size)) ** 2)[:flux.size]   # autocorrelation by FFT: n log n, not n²
    lags = np.arange(ac.size)
    bpms = 60 * fps / np.maximum(lags, 1)
    ok = (bpms >= 70) & (bpms <= 180)
    if not ok.any():
        die("audio too short to find a tempo")
    lag = lags[ok][np.argmax(ac[ok])]
    # phase: the offset whose comb of beats collects the most onset energy
    scores = [flux[o::lag].sum() for o in range(lag)]
    return dict(bpm=round(float(60 * fps / lag), 2), first_beat=round(float(np.argmax(scores)) / fps, 3), duration=round(x.size / sr, 2))


def mux(video, raw_audio, meta_json, out, offset=None):
    """Recorder output (video .mkv, game-only f32le audio, and the QPC timing json) to an mp4 with synced sound."""
    meta = json.loads(Path(meta_json).read_text())
    dur = probe(video)["duration"]
    start = offset if offset is not None else meta.get("audio_offset_s", 0.0)
    ff("-i", video, "-f", meta.get("format", "f32le"), "-ar", meta.get("rate", 48000), "-ac", meta.get("channels", 2), "-ss", f"{max(0.0, start):.3f}", "-i", raw_audio,
       "-map", "0:v", "-map", "1:a", "-t", f"{dur:.3f}", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
       "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out)
    print(out)


# --------------------------------------------------------------------------- graphics (Pillow)


def _rgba(hexs, default="#FFFFFF"):
    s = (hexs or default).lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4)) + ((int(s[6:8], 16),) if len(s) >= 8 else (255,))


def _font(path, size):
    from PIL import ImageFont
    return ImageFont.truetype(str(path), size)


def title_chip(text, credit, W, H, theme, out):
    """One-line lower-left title: dark rounded chip, accent bar, bold title, and the credit handle in mono accent."""
    from PIL import Image, ImageDraw
    s = H / 1080
    big, small = _font(TITLE_FONT, round(50 * s)), _font(MONO_FONT, round(30 * s))
    img = Image.new("RGBA", (W, H))
    dr = ImageDraw.Draw(img)
    pad_x, bar = round(30 * s), round(8 * s)
    tw = dr.textlength(text, font=big)
    cw = dr.textlength(credit, font=small) if credit else 0
    gap = round(22 * s) if credit else 0
    w = int(bar + pad_x + tw + gap + cw + pad_x)
    h = round(84 * s)
    x0, y0 = round(64 * s), H - round(70 * s) - h
    chip, accent = _rgba(theme.get("chip"), "#0A0D12E0"), _rgba(theme.get("accent"), "#B6FF3B")
    dr.rounded_rectangle((x0, y0, x0 + w, y0 + h), radius=round(16 * s), fill=chip)
    dr.rounded_rectangle((x0, y0, x0 + bar + round(10 * s), y0 + h), radius=round(16 * s), fill=accent)
    dr.rectangle((x0 + bar, y0, x0 + bar + round(10 * s), y0 + h), fill=chip)

    def middle(font, sample):
        box = font.getbbox(sample)
        return y0 + (h - (box[3] - box[1])) // 2 - box[1]

    dr.text((x0 + bar + pad_x, middle(big, "Ag")), text, font=big, fill=_rgba(theme.get("text"), "#FFFFFF"))
    if credit:
        dr.text((x0 + bar + pad_x + tw + gap, middle(small, "@g")), credit, font=small, fill=accent)
    img.save(out)


def hook_text(text, W, H, theme, out, size=112):
    """Big centred statement with a soft shadow, for the cold open."""
    from PIL import Image, ImageDraw, ImageFilter
    s = H / 1080
    f = _font(TITLE_FONT, round(size * s))
    lines = text.split("\n")
    img = Image.new("RGBA", (W, H))
    sh = Image.new("RGBA", (W, H))
    dr, ds = ImageDraw.Draw(img), ImageDraw.Draw(sh)
    lh = round(f.size * 1.08)
    y = (H - lh * len(lines)) // 2
    for line in lines:
        x = (W - dr.textlength(line, font=f)) / 2
        ds.text((x, y + round(6 * s)), line, font=f, fill=(0, 0, 0, 200))
        dr.text((x, y), line, font=f, fill=_rgba(theme.get("text"), "#FFFFFF"))
        y += lh
    sh = sh.filter(ImageFilter.GaussianBlur(round(14 * s)))
    sh.alpha_composite(img)
    sh.save(out)


def card(spec, W, H, theme, out):
    """Full-frame title card: solid or image background, big title, and an optional sub line and logo."""
    from PIL import Image, ImageDraw, ImageFilter
    s = H / 1080
    bg = spec.get("bg", "#05070A")
    if isinstance(bg, str) and Path(bg).exists():
        im = Image.open(bg).convert("RGB")
        r = max(W / im.width, H / im.height)
        im = im.resize((round(im.width * r), round(im.height * r)), Image.Resampling.LANCZOS)
        im = im.crop(((im.width - W) // 2, (im.height - H) // 2, (im.width - W) // 2 + W, (im.height - H) // 2 + H)).convert("RGBA")
        if spec.get("dim", 0.45):
            im.alpha_composite(Image.new("RGBA", (W, H), (0, 0, 0, int(255 * spec.get("dim", 0.45)))))
    else:
        im = Image.new("RGBA", (W, H), _rgba(bg))
        # soft radial glow in the accent colour
        glow = Image.new("RGBA", (W, H))
        acc = _rgba(theme.get("accent"), "#B6FF3B")
        ImageDraw.Draw(glow).ellipse((W * 0.2, H * 0.05, W * 0.8, H * 0.95), fill=acc[:3] + (46,))
        im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(round(220 * s))))
    dr = ImageDraw.Draw(im)
    logo = spec.get("logo")
    title, sub = spec.get("title", ""), spec.get("sub", "")
    tf, sf = _font(TITLE_FONT, round(spec.get("size", 104) * s)), _font(BODY_FONT, round(spec.get("sub_size", 44) * s))
    blocks = []
    if logo and Path(logo).exists():
        L = Image.open(logo).convert("RGBA")
        lh = round(spec.get("logo_height", 150) * s)
        L = L.resize((round(L.width * lh / L.height), lh), Image.Resampling.LANCZOS)
        blocks.append(("img", L, lh))
    blocks += [("t", line, round(tf.size * 1.12)) for line in title.split("\n") if title]
    if sub:
        blocks.append(("s", sub, round(sf.size * 1.6)))
    y = (H - sum(b[2] for b in blocks) - (round(30 * s) if logo else 0)) / 2
    for kind, v, h in blocks:
        match kind:
            case "img":
                im.alpha_composite(v, (int((W - v.width) / 2), int(y)))
                y += h + round(30 * s)
            case "t":
                dr.text(((W - dr.textlength(v, font=tf)) / 2, y), v, font=tf, fill=_rgba(theme.get("text"), "#FFFFFF"))
                y += h
            case _:
                dr.text(((W - dr.textlength(v, font=sf)) / 2, y + round(10 * s)), v, font=sf, fill=_rgba(spec.get("sub_color") or theme.get("accent"), "#B6FF3B"))
                y += h
    im.convert("RGB").save(out)


def badge(text, W, H, theme, out):
    from PIL import Image, ImageDraw
    s = H / 1080
    f = _font(MONO_FONT, round(26 * s))
    img = Image.new("RGBA", (W, H))
    dr = ImageDraw.Draw(img)
    tw = dr.textlength(text, font=f)
    x0, y0 = round(64 * s), round(56 * s)
    dr.rounded_rectangle((x0, y0, x0 + tw + round(28 * s), y0 + round(46 * s)), radius=round(10 * s), fill=_rgba(theme.get("chip"), "#0A0D12E0"))
    dr.text((x0 + round(14 * s), y0 + round(8 * s)), text, font=f, fill=_rgba(theme.get("accent"), "#B6FF3B"))
    img.save(out)


# --------------------------------------------------------------------------- compile


def _seg_dur(seg, bpm):
    if "beats" in seg:
        if not bpm:
            die("segment uses 'beats' but the EDL has no 'bpm'")
        return seg["beats"] * 60.0 / bpm
    return float(seg.get("dur", 4.0))


def _fill_filter(fill, W, H, zoom=1.0, crop=None):
    pre = f"crop={crop[2]}:{crop[3]}:{crop[0]}:{crop[1]}," if crop else ""
    z = f",scale=iw*{zoom}:ih*{zoom},crop={W}:{H}" if zoom and zoom != 1.0 else ""
    match fill:
        case "crop":
            return f"{pre}scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H}{z}"
        case "pad":
            return f"{pre}scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=black{z}"
        case _:  # blur: a blurred, darkened cover behind a fitted foreground
            return (f"{pre}split[fa][fb];[fa]scale={W // 4}:{H // 4}:force_original_aspect_ratio=increase,crop={W // 4}:{H // 4},boxblur=12:2,"
                    f"eq=brightness=-0.12:saturation=1.2,scale={W}:{H}[bgd];[fb]scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos[fgd];"
                    f"[bgd][fgd]overlay=(W-w)/2:(H-h)/2{z}")


def render_segment(i, seg, edl, work: Path, W, H, fps, dur, t_in, t_out, total_n):
    theme = edl.get("theme", {})
    out = work / f"seg_{i:02d}.mkv"
    vcodec = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-pix_fmt", "yuv420p", "-r", str(fps)]
    acodec = ["-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2"]
    if "card" in seg:
        png = work / f"card_{i:02d}.png"
        card(seg["card"], W, H, theme, png)
        frames = max(1, round(dur * fps))
        zin = seg["card"].get("push", 0.04)
        vf = (f"scale={W * 2}:{H * 2},zoompan=z='1+{zin}*on/{frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps={fps},"
              f"format=yuv420p")
        ff("-loop", "1", "-framerate", fps, "-t", f"{dur:.3f}", "-i", png, "-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=48000:cl=stereo",
           "-filter_complex", f"[0:v]{vf}[v]", "-map", "[v]", "-map", "1:a", "-t", f"{dur:.3f}", *vcodec, *acodec, out)
        return out

    src = seg["clip"]
    info = probe(src)
    speed = float(seg.get("speed", 1.0))
    src_len = dur * speed
    start = float(seg.get("in", 0.0))
    if start + src_len > info["duration"] + 0.05:
        die(f"segment {i}: {src} is {info['duration']:.2f}s; in={start} + {src_len:.2f}s runs past the end")
    inputs = ["-ss", f"{start:.3f}", "-t", f"{src_len + 0.1:.3f}", "-i", src]
    graph = [f"[0:v]setpts=(PTS-STARTPTS)/{speed},fps={fps},{_fill_filter(seg.get('fill', 'blur'), W, H, seg.get('zoom', 1.0), seg.get('crop'))},setsar=1[base]"]
    last = "base"
    overlays = []
    if seg.get("title"):
        png = work / f"title_{i:02d}.png"
        title_chip(seg["title"], seg.get("credit"), W, H, theme, png)
        overlays.append(("title", png))
    if seg.get("hook"):
        png = work / f"hook_{i:02d}.png"
        hook_text(seg["hook"], W, H, theme, png, seg.get("hook_size", 112))
        overlays.append(("hook", png))
    if edl.get("counter") and seg.get("title"):
        png = work / f"badge_{i:02d}.png"
        badge(f"{seg.get('index', i):02d}/{total_n:02d}", W, H, theme, png)
        overlays.append(("badge", png))
    for k, (kind, png) in enumerate(overlays, 1):   # input 0 is the clip
        inputs += ["-loop", "1", "-framerate", str(fps), "-t", f"{dur:.3f}", "-i", str(png)]
        match kind:
            case "hook":
                a0, a1 = seg.get("hook_in", 0.15), seg.get("hook_out", dur - t_out - 0.1)
                graph.append(f"[{k}:v]format=rgba,fade=t=in:st={a0:.2f}:d=0.3:alpha=1,fade=t=out:st={max(a0 + 0.3, a1 - 0.3):.2f}:d=0.3:alpha=1[o{k}]")
                graph.append(f"[{last}][o{k}]overlay=0:0:shortest=1[v{k}]")
            case _:
                t0 = t_in + seg.get("title_delay", 0.2)
                t1 = min(dur - t_out - 0.1, t0 + seg.get("title_hold", 99))
                graph.append(f"[{k}:v]format=rgba,fade=t=in:st={t0:.2f}:d=0.25:alpha=1,fade=t=out:st={max(t0 + 0.3, t1 - 0.25):.2f}:d=0.25:alpha=1[o{k}]")
                slide = f"-70*pow(1-clip((t-{t0:.2f})/0.4\\,0\\,1)\\,3)" if kind == "title" else "0"
                graph.append(f"[{last}][o{k}]overlay=x='{slide}':y=0:shortest=1[v{k}]")
        last = f"v{k}"
    graph.append(f"[{last}]format=yuv420p[v]")
    vol = float(seg.get("volume", edl.get("clip_volume", 0.6)))
    if info["audio"]:
        tempo, sp = [], speed
        while not 0.5 <= sp <= 2.0:   # one atempo filter takes 0.5-2.0, so chain them
            step = 2.0 if sp > 2.0 else 0.5
            tempo.append(f"atempo={step}")
            sp /= step
        tempo.append(f"atempo={sp:.4f}")
        norm = "loudnorm=I=-18:TP=-2:LRA=11," if edl.get("normalize_audio") else ""
        graph.append(f"[0:a]asetpts=PTS-STARTPTS,{','.join(tempo)},aresample=48000,aformat=channel_layouts=stereo,{norm}"
                     f"aresample=48000,volume={vol},apad[a]")
        amap = "[a]"
    else:
        inputs += ["-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
        amap = f"{len(overlays) + 1}:a"
    ff(*inputs, "-filter_complex", ";".join(graph), "-map", "[v]", "-map", amap, "-t", f"{dur:.3f}", *vcodec, *acodec, out)
    return out


def compile_edl(edl_path, out, preview=False, keep=False):
    need("PIL", "pillow")
    edl_path = Path(edl_path)
    edl = json.loads(edl_path.read_text())
    base = edl_path.parent

    def rel(p):
        return str((base / p).resolve()) if p and not Path(p).is_absolute() else p

    def media(p):
        """A watermark, sfx, or music file: a missing file is an error, so that a typo does not drop it."""
        if not Path(rel(p)).exists():
            die(f"file not found: {p}")
        return rel(p)

    for seg in edl["segments"]:
        if "clip" in seg:
            seg["clip"] = rel(seg["clip"])
        if "card" in seg:
            for k in ("bg", "logo"):
                if seg["card"].get(k) and not str(seg["card"][k]).startswith("#"):
                    seg["card"][k] = rel(seg["card"][k])
    W, H = edl.get("size", [1920, 1080])
    fps = edl.get("fps", 30)
    if preview:
        W, H, fps = W // 2, H // 2, min(fps, 30)
    bpm = edl.get("bpm")
    default_tr = edl.get("transition", {"type": "fade", "duration": 0.3})
    segs = edl["segments"]
    durs = [_seg_dur(s, bpm) for s in segs]
    trans = []
    for k in range(len(segs) - 1):
        t = dict(default_tr, **segs[k + 1].get("transition", {}))
        if t.get("type") == "cut" or float(t.get("duration", 0)) < 1.5 / fps:
            t = dict(type="cut", duration=0.0)     # a hard cut is a concat, because a sub-frame xfade breaks the chain
        trans.append(t)
    if edl.get("beat_lock"):
        # xfade overlaps segments by the transition length: lengthen each segment by it, so every cut lands on the grid
        durs = [d + (trans[k]["duration"] if k < len(trans) else 0.0) for k, d in enumerate(durs)]
    work = Path(tempfile.mkdtemp(prefix="um_video_"))
    titled = [s for s in segs if s.get("title")]
    for n, s in enumerate(titled, 1):
        s["index"] = n
    files = []
    for i, (seg, dur) in enumerate(zip(segs, durs)):
        t_in = trans[i - 1]["duration"] if i > 0 else 0.0
        t_out = trans[i]["duration"] if i < len(trans) else 0.0
        print(f"  segment {i + 1}/{len(segs)}: {'card' if 'card' in seg else Path(seg['clip']).name} {dur:.2f}s")
        files.append(render_segment(i, seg, edl, work, W, H, fps, dur, t_in, t_out, len(titled)))

    # join with transitions
    inputs, graph = [], []
    for k, f in enumerate(files):   # one timebase for each input: concat and xfade refuse to mix them
        inputs += ["-i", f]
        graph.append(f"[{k}:v]settb=AVTB,setpts=PTS-STARTPTS[s{k}]")
    total = durs[0]
    vlast, alast = "s0", "0:a"
    for k in range(1, len(files)):
        d = trans[k - 1]["duration"]
        if trans[k - 1]["type"] == "cut":
            graph.append(f"[{vlast}][s{k}]concat=n=2:v=1:a=0[xv{k}]")
            graph.append(f"[{alast}][{k}:a]concat=n=2:v=0:a=1[xa{k}]")
        else:
            graph.append(f"[{vlast}][s{k}]xfade=transition={trans[k - 1].get('type', 'fade')}:duration={d}:offset={total - d:.4f}[xv{k}]")
            graph.append(f"[{alast}][{k}:a]acrossfade=d={d}:c1=tri:c2=tri[xa{k}]")
        vlast, alast = f"xv{k}", f"xa{k}"
        total = total + durs[k] - d
    n = len(files)
    fade_out = edl.get("fade_out", 0.8)
    wm = edl.get("watermark")
    if wm:
        from PIL import Image
        L = Image.open(media(wm["path"])).convert("RGBA")
        s = H / 1080
        lh = round(wm.get("height", 54) * s)
        L = L.resize((round(L.width * lh / L.height), lh), Image.Resampling.LANCZOS)
        L.putalpha(L.getchannel("A").point(lambda v: int(v * wm.get("opacity", 0.9))))
        wpath = work / "wm.png"
        L.save(wpath)
        inputs += ["-loop", "1", "-framerate", str(fps), "-t", f"{total:.3f}", "-i", wpath]
        m = round(wm.get("margin", 40) * s)
        corners = {"br": f"W-w-{m}:H-h-{m}", "bl": f"{m}:H-h-{m}", "tr": f"W-w-{m}:{m}", "tl": f"{m}:{m}"}
        corner = wm.get("corner", "br")
        if corner not in corners:
            die(f"watermark corner must be one of {', '.join(corners)}, not {corner}")
        # hide it on cards, because they carry the logo already
        spans, t = [], 0.0
        for k, seg in enumerate(segs):
            if "card" in seg or seg.get("watermark") is False:
                spans.append((t, t + durs[k]))
            t += durs[k] - (trans[k]["duration"] if k < len(trans) else 0)
        en = "+".join(f"between(t,{a0:.2f},{a1:.2f})" for a0, a1 in spans) or "0"
        graph.append(f"[{vlast}][{n}:v]overlay={corners[corner]}:enable='not({en})'[wmv]")
        vlast = "wmv"
        n += 1
    graph.append(f"[{vlast}]fade=t=out:st={total - fade_out:.3f}:d={fade_out},format=yuv420p[vout]")
    mix = [alast]
    for j, fx in enumerate(edl.get("sfx", [])):   # one-shot sounds on the final timeline: {"path", "at", "volume"}
        inputs += ["-i", media(fx["path"])]
        ms = int(float(fx.get("at", 0)) * 1000)
        graph.append(f"[{n}:a]aresample=48000,aformat=channel_layouts=stereo,volume={fx.get('volume', 0.8)},adelay={ms}|{ms}[fx{j}]")
        mix.append(f"fx{j}")
        n += 1
    if len(mix) > 1:
        graph.append("".join(f"[{m}]" for m in mix) + f"amix=inputs={len(mix)}:duration=first:normalize=0[sfxmix]")
        alast = "sfxmix"
    music = edl.get("music")
    if music:
        inputs += ["-ss", str(music.get("start", 0)), "-i", media(music["path"])]
        graph.append(f"[{n}:a]aresample=48000,aformat=channel_layouts=stereo,volume={music.get('volume', 0.8)},"
                     f"afade=t=in:d={music.get('fade_in', 0.2)},atrim=0:{total:.3f}[mus]")
        graph.append(f"[{alast}][mus]amix=inputs=2:duration=first:normalize=0,afade=t=out:st={total - fade_out:.3f}:d={fade_out},alimiter=limit=0.95[aout]")
    else:
        graph.append(f"[{alast}]afade=t=out:st={total - fade_out:.3f}:d={fade_out},alimiter=limit=0.95[aout]")
    enc = ["-c:v", "libx264", "-preset", "veryfast" if preview else "slow", "-crf", "23" if preview else "18", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]
    ff(*inputs, "-filter_complex", ";".join(graph), "-map", "[vout]", "-map", "[aout]", "-t", f"{total:.3f}", *enc, out)
    if not keep:
        shutil.rmtree(work, ignore_errors=True)
    print(f"wrote {out}  ({total:.2f}s, {W}x{H}@{fps})")


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="um video", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    cs = p.add_subparsers(dest="cmd", metavar="<cmd>", required=True)
    q = cs.add_parser("probe", help="duration / size / fps / audio")
    q.add_argument("input")
    q = cs.add_parser("contact", help="timestamped frame grid for choosing moments")
    q.add_argument("input")
    q.add_argument("output")
    q.add_argument("--every", type=float, default=2.0)
    q.add_argument("--cols", type=int, default=6)
    q.add_argument("--width", type=int, default=320)
    q.add_argument("--start", type=float, default=0.0)
    q.add_argument("--end", type=float)
    q = cs.add_parser("first-frame", help="seconds until the first gameplay frame")
    q.add_argument("input")
    q = cs.add_parser("beats", help="tempo and first beat of a music file")
    q.add_argument("input")
    q = cs.add_parser("mux", help="recorder .mkv + .audio.raw + .json -> mp4")
    q.add_argument("video")
    q.add_argument("audio")
    q.add_argument("meta")
    q.add_argument("output")
    q.add_argument("--offset", type=float, help="audio offset override (s)")
    q = cs.add_parser("compile", help="render an EDL json into a finished video")
    q.add_argument("edl")
    q.add_argument("output")
    q.add_argument("--preview", action="store_true", help="half resolution, fast encode")
    q.add_argument("--keep", action="store_true", help="keep the work folder")
    return p


def main(argv=None):
    a = parser().parse_args(argv)
    match a.cmd:
        case "probe":
            print(json.dumps(probe(a.input), indent=2))
        case "contact":
            contact(a.input, a.output, a.every, a.cols, a.width, a.start, a.end)
        case "first-frame":
            print(first_frame(a.input))
        case "beats":
            print(json.dumps(beats(a.input)))
        case "mux":
            mux(a.video, a.audio, a.meta, a.output, a.offset)
        case "compile":
            compile_edl(a.edl, a.output, a.preview, a.keep)


if __name__ == "__main__":
    main()
