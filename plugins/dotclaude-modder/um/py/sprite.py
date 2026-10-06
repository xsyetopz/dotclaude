# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10", "numpy"]
# ///
"""2D sprite tools: turn generated art into the exact frames that a game expects.

    um sprite info in.png                               # size, alpha coverage, bbox, colours
    um sprite cutout in.png out.png                     # flat background -> transparent (border flood fill)
    um sprite fit in.png out.png --size 64x26           # trim + nearest-neighbour fit into a frame (pixel art)
    um sprite fit in.png out.png --size 38x34 --anchor bottom --smooth
    um sprite pixelate in.png out.png --size 32x32 --colors 16 --outline
    um sprite palette in.png out.png --from ref.png     # snap colours to the palette of a game
    um sprite sheet out.png f1.png f2.png ... --cols 4  # pack frames in a grid, or --vertical for one column
    um sprite slice sheet.png outdir --frame 32x32      # split a sheet into frames
    um sprite frames in.png outdir --n 3 --kind bob     # idle animation from one frame (bob, squash, wobble, flash)
    um sprite team-mask in.png out.png --hue blue       # saturated accent -> player-colour mask
    um sprite seamless in.png out.png                   # make a texture tile (offset + cross-blend)
    um sprite tile-preview in.png out.png               # 3x3 tiling preview to check the seams
    um sprite preview in.png out.png --scale 4          # checkerboard + scale, for looking at it
    um sprite outline | hard-alpha | flip | rotate      # small single-image edits

Rules of thumb: generate on a flat background or with real transparency.
Cut out with a border flood fill, because it keeps interior whites such as eyes.
Trim, then scale ONCE with nearest neighbour to the frame size of the engine.
Keep the facing direction that the engine uses (Terraria items point right, NPC sprites face left).
The frame layout comes from the draw code of the engine.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from common import die, need, parse_size

need("PIL", "pillow")
np = need("numpy")
from PIL import Image, ImageChops, ImageEnhance, ImageOps  # noqa: E402


def load(path) -> Image.Image:
    try:
        return Image.open(path).convert("RGBA")
    except (OSError, ValueError) as e:
        die(f"cannot read {path}: {e}")


# --------------------------------------------------------------------------- core ops


def border_color(im, k: int = 4):
    """Median colour of the four corners (k x k each): the flat background colour."""
    w, h = im.size
    k = min(k, w, h)
    px = im.load()
    samples = [px[x, y][:3] for cx, cy in ((0, 0), (w - k, 0), (0, h - k), (w - k, h - k))
               for x in range(cx, cx + k) for y in range(cy, cy + k)]
    return tuple(sorted(c[i] for c in samples)[len(samples) // 2] for i in range(3))


def cutout(im, tol: int = 28, bg=None, grey: int | None = None, spread: int = 24, holes: bool = False, keep_top: float = 1.0):
    """Flood-fill the background from the image border.
    tol: colour distance to the background (found from the corners).
    grey: also treat light unsaturated pixels (min channel >= grey) as background, such as a soft drop shadow.
    holes: also clear enclosed background-coloured areas.
    keep_top < 1 drops the bottom part (a shadow under the object)."""
    im = im.copy()
    if im.getextrema()[3][0] < 250 and bg is None:
        return im.crop(im.getbbox() or (0, 0, 1, 1))   # it has transparency already
    im = im.crop((0, 0, im.width, max(1, int(im.height * keep_top))))
    bg = bg or border_color(im)
    a = np.array(im)
    rgb = a[..., :3].astype(np.int32)
    mask = np.abs(rgb - np.array(bg, np.int32)).sum(-1) <= tol * 3
    if grey is not None:
        mask |= (rgb.min(-1) >= grey) & (rgb.max(-1) - rgb.min(-1) < spread)
    # Level-by-level flood fill from the border: each step touches only the new frontier.
    h, w = mask.shape
    pad = np.zeros((h + 2, w + 2), bool)
    pad[1:-1, 1:-1] = mask
    edge = np.zeros_like(pad)
    edge[1], edge[-2], edge[:, 1], edge[:, -2] = True, True, True, True
    flat, step = pad.ravel(), w + 2
    seen = np.zeros(flat.size, bool)
    front = np.flatnonzero(flat & edge.ravel())
    while front.size:
        seen[front] = True
        near = np.unique(np.concatenate((front + 1, front - 1, front + step, front - step)))
        front = near[flat[near] & ~seen[near]]
    clear = seen.reshape(pad.shape)[1:-1, 1:-1] | (mask if holes else False)
    a[..., 3][clear] = 0
    im = Image.fromarray(a, "RGBA")
    return im.crop(im.getbbox() or (0, 0, 1, 1))


def hard_alpha(im, thresh: int = 128):
    """Binary alpha (pixel art, BC1 punch-through): >= thresh opaque, else clear."""
    im = im.copy()
    im.putalpha(im.getchannel("A").point(lambda v: 255 if v >= thresh else 0))
    return im


def trim(im):
    return im.crop(im.getbbox()) if im.getbbox() else im


def fit(im, w: int, h: int, anchor: str = "center", smooth: bool = False, allow_upscale: bool = True):
    """Trim, scale to fit inside w x h (nearest neighbour unless smooth), place on a transparent frame."""
    im = trim(im)
    s = min(w / im.width, h / im.height)
    if not allow_upscale:
        s = min(s, 1.0)
    small = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.Resampling.LANCZOS if smooth else Image.Resampling.NEAREST)
    frame = Image.new("RGBA", (w, h))
    y = {"center": (h - small.height) // 2, "bottom": h - small.height, "top": 0}[anchor]
    frame.paste(small, ((w - small.width) // 2, y))
    return frame


def pixelate(im, w: int, h: int, colors: int | None = 16, outline: tuple | None = None, alpha_thresh: int = 110):
    """Area-average down to w x h (keeps the aspect), hard alpha, optional palette + 1px outline."""
    im = trim(im)
    s = min(w / im.width, h / im.height)
    size = (max(1, round(im.width * s)), max(1, round(im.height * s)))
    # Premultiply, so that transparent pixels do not bleed their colour into the edges.
    a = np.asarray(im).astype(np.float32)
    a[..., :3] *= a[..., 3:4] / 255.0
    b = np.asarray(Image.fromarray(a.clip(0, 255).astype(np.uint8), "RGBA").resize(size, Image.Resampling.BOX)).astype(np.float32)
    alpha = b[..., 3:4]
    b[..., :3] = np.where(alpha > 0, b[..., :3] * 255.0 / np.maximum(alpha, 1), 0)
    small = hard_alpha(Image.fromarray(b.clip(0, 255).astype(np.uint8), "RGBA"), alpha_thresh)
    if colors:
        rgb = small.convert("RGB").quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")
        small = Image.merge("RGBA", (*rgb.split(), small.getchannel("A")))
    if outline:
        small = add_outline(small, outline)
    frame = Image.new("RGBA", (w, h))
    frame.paste(small, ((w - small.width) // 2, (h - small.height) // 2), small)
    return frame


def add_outline(im, color=(20, 16, 24, 255)):
    """1px outline around opaque pixels (inside the canvas, so it crops if the sprite touches the edge)."""
    a = np.array(im)
    solid = np.pad(a[..., 3] > 0, 1)
    near = solid[:-2, 1:-1] | solid[2:, 1:-1] | solid[1:-1, :-2] | solid[1:-1, 2:]
    a[near & (a[..., 3] == 0)] = Image.new("RGBA", (1, 1), tuple(color)).getpixel((0, 0))
    return Image.fromarray(a, "RGBA")


def palette_from(ref, max_colors: int = 64):
    """Distinct opaque colours of a reference sprite or sheet, most frequent first."""
    colors = ref.getcolors(1 << 20)
    if colors is None:
        die("the palette reference has more than 1M colours: it is not a palette image")
    pal = [c[:3] for _, c in sorted(colors, reverse=True) if c[3] > 0][:max_colors]
    if not pal:
        die("the palette reference has no opaque pixels")
    return pal


def snap_palette(im, pal):
    a = np.asarray(im).copy()
    P = np.array(pal, np.int32)
    # Snap each distinct colour once, in chunks, so the distance table stays small.
    keys = a[..., :3].astype(np.int32) @ np.array([65536, 256, 1], np.int32)
    uniq, inv = np.unique(keys, return_inverse=True)
    rgb = np.stack((uniq >> 16, uniq >> 8 & 255, uniq & 255), -1)
    snapped = np.concatenate([P[((c[:, None] - P[None]) ** 2).sum(-1).argmin(-1)] for c in np.array_split(rgb, -(-len(rgb) // 4096))])
    a[..., :3] = snapped[inv.reshape(a.shape[:2])].astype(np.uint8)
    return Image.fromarray(a, "RGBA")


def sheet(frames, cols: int | None = None, pad: int = 0, vertical: bool = False):
    fw, fh = max(f.width for f in frames), max(f.height for f in frames)
    cols = 1 if vertical else cols or len(frames)
    rows = -(-len(frames) // cols)
    out = Image.new("RGBA", (cols * (fw + pad) - pad, rows * (fh + pad) - pad))
    for i, f in enumerate(frames):
        out.paste(f, ((i % cols) * (fw + pad), (i // cols) * (fh + pad)))
    return out


def slice_sheet(im, fw: int, fh: int, pad: int = 0):
    frames = []
    for y in range(0, im.height - fh + 1, fh + pad):
        for x in range(0, im.width - fw + 1, fw + pad):
            f = im.crop((x, y, x + fw, y + fh))
            if f.getbbox():
                frames.append(f)
    return frames


def simple_frames(im, n: int = 3, kind: str = "bob"):
    """Idle animation from one frame: bob (1px up and down), squash (slime), wobble (rotate), flash (brighten)."""
    out = []
    for k in range(n):
        match kind:
            case "bob":
                out.append(ImageChops.offset(im, 0, (0, -1, 0, 1)[k % 4]))
            case "squash":
                s = 1 + 0.08 * ((-1) ** k) * (k > 0)
                w, h = round(im.width * s), round(im.height / s)
                f = Image.new("RGBA", im.size)
                f.paste(im.resize((w, h), Image.Resampling.NEAREST), ((im.width - w) // 2, im.height - h))
                out.append(f)
            case "wobble":
                out.append(im.rotate((0, -5, 0, 5)[k % 4], resample=Image.Resampling.NEAREST))
            case "flash":
                # Brighten the colour only: `Brightness` on RGBA would also raise the alpha.
                f = ImageEnhance.Brightness(im.convert("RGB")).enhance(1 + 0.35 * (k % 2)).convert("RGBA")
                f.putalpha(im.getchannel("A"))
                out.append(f)
    return out


def team_mask(im, hue: str = "blue", sat_lo: float = 0.25, val_lo: float = 0.15):
    """Saturated accent pixels (blue, red, green, magenta) -> 0-255 mask, and the sprite with those areas
    turned into grey shading. RTS engines (the SLD player layer of AoE2, and others) store the player colour so."""
    a = np.asarray(im).astype(np.float32)
    r, g, b = a[..., 0] / 255, a[..., 1] / 255, a[..., 2] / 255
    mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
    sat = (mx - mn) / (mx + 1e-6)
    sel = {"blue": (b >= r * 1.25) & (b >= g * 0.9), "red": (r >= g * 1.4) & (r >= b * 1.4),
           "green": (g >= r * 1.25) & (g >= b * 1.1), "magenta": (r >= g * 1.4) & (b >= g * 1.4)}[hue]
    m = np.clip((sat - sat_lo) / 0.35, 0, 1) * sel * (a[..., 3] > 0) * (mx > val_lo)
    lum = (0.3 * a[..., 0] + 0.59 * a[..., 1] + 0.11 * a[..., 2])[..., None]
    k = m[..., None]
    out = a.copy()
    out[..., :3] = a[..., :3] * (1 - k) + np.clip(lum * 1.15, 0, 255) * k
    return Image.fromarray(out.clip(0, 255).astype(np.uint8), "RGBA"), Image.fromarray((m * 255).astype(np.uint8), "L")


def seamless(im, blend: float = 0.25):
    """Tileable texture: offset by half, and cross-fade the seams with the original.
    It works well on noisy textures. For a hero texture, prefer `um fal texture`, which makes a tiling image."""
    if not 0 < blend <= 0.5:
        die(f"--blend must be more than 0 and at most 0.5, not {blend}")
    a = np.asarray(im).astype(np.float32)
    h, w = a.shape[:2]
    shifted = np.roll(np.roll(a, h // 2, 0), w // 2, 1)
    yy, xx = np.mgrid[0:h, 0:w]
    dx = np.minimum(xx, w - 1 - xx) / (w * blend)
    dy = np.minimum(yy, h - 1 - yy) / (h * blend)
    wgt = np.clip(np.minimum(dx, dy), 0, 1)[..., None]   # 0 at the edges of the original: use the shifted copy there
    return Image.fromarray((a * wgt + shifted * (1 - wgt)).clip(0, 255).astype(np.uint8), "RGBA")


def tile_preview(im, n: int = 3):
    out = Image.new("RGBA", (im.width * n, im.height * n))
    for y in range(n):
        for x in range(n):
            out.paste(im, (x * im.width, y * im.height))
    return out


def preview(im, scale: int = 4, checker: int = 8):
    """Scaled-up view on a checkerboard, so that transparency and pixel edges show."""
    big = im.resize((im.width * scale, im.height * scale), Image.Resampling.NEAREST)
    c = checker * max(1, scale // 2)
    yy, xx = np.mgrid[0:big.height, 0:big.width]
    grey = np.where(((xx // c) + (yy // c)) % 2, 150, 200).astype(np.uint8)
    bg = Image.fromarray(np.dstack([grey, grey, grey, np.full_like(grey, 255)]), "RGBA")
    bg.alpha_composite(big)
    return bg


def info(im) -> dict:
    hist = im.getchannel("A").histogram()
    total = im.width * im.height
    colors = im.getcolors(1 << 20)
    opaque, clear = sum(hist[250:]) / total, hist[0] / total
    return dict(size=im.size, bbox=im.getbbox(), opaque=round(opaque, 3), clear=round(clear, 3),
                partial=round(1 - opaque - clear, 3), colors=len(colors) if colors else ">1M", corner_color=border_color(im))


# --------------------------------------------------------------------------- CLI


def _color(s: str | None):
    if not s:
        return None
    s = s.lstrip("#")
    try:
        if len(s) not in (6, 8):
            raise ValueError
        return tuple(int(s[i:i + 2], 16) for i in range(0, len(s), 2)) + (255,) * (len(s) == 6)
    except ValueError:
        die(f"not a colour (use RRGGBB or RRGGBBAA): {s}")


def _size(s: str) -> tuple[int, int]:
    w, h = parse_size(s)
    if w < 1 or h < 1:
        die(f"not a size: {s}")
    return w, h


def save_frames(outdir, stem: str, width: int, frames):
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    for i, f in enumerate(frames):
        f.save(out / f"{stem}_{i:0{width}d}.png")
    print(out)


def main(a):
    match a.cmd:
        case "info":
            for p in a.inputs:
                print(p, info(load(p)))
            return
        case "sheet":
            sheet([load(p) for p in a.frames], a.cols, a.pad, a.vertical).save(a.output)
            print(a.output)
            return
        case "slice":
            return save_frames(a.outdir, "frame", 3, slice_sheet(load(a.input), *_size(a.frame), a.pad))
        case "frames":
            return save_frames(a.outdir, Path(a.input).stem, 1, simple_frames(load(a.input), a.n, a.kind))
    im = load(a.input)
    match a.cmd:
        case "cutout":
            im = cutout(im, a.tol, _color(a.bg), a.grey, a.spread, a.holes, a.keep_top)
        case "fit":
            im = fit(im, *_size(a.size), a.anchor, a.smooth, not a.no_upscale)
            if a.hard_alpha:
                im = hard_alpha(im)
        case "pixelate":
            im = pixelate(im, *_size(a.size), a.colors or None, _color(a.outline_color) if a.outline else None)
        case "palette":
            im = snap_palette(im, palette_from(load(getattr(a, "from")), a.max_colors))
        case "team-mask":
            im, mask = team_mask(im, a.hue)
            mask.save(Path(a.output).with_name(Path(a.output).stem + "_mask.png"))
        case "seamless":
            im = seamless(im, a.blend)
        case "tile-preview":
            im = tile_preview(im, a.n)
        case "preview":
            im = preview(im, a.scale)
        case "outline":
            im = add_outline(im, _color(a.color))
        case "hard-alpha":
            im = hard_alpha(im, a.thresh)
        case "flip":
            im = ImageOps.flip(im) if a.vertical else ImageOps.mirror(im)
        case "rotate":
            im = im.rotate(a.degrees, expand=True, resample=Image.Resampling.NEAREST)
    im.save(a.output)
    print(a.output, im.size)


def parser():
    p = argparse.ArgumentParser(prog="um sprite", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    cs = p.add_subparsers(dest="cmd", metavar="<cmd>", required=True)

    def cmd(name, help_, *positionals):
        q = cs.add_parser(name, help=help_)
        for pos in positionals:
            q.add_argument(pos, nargs="+" if pos in ("inputs", "frames") else None)
        return q

    def image_cmd(name, help_):
        return cmd(name, help_, "input", "output")

    cmd("info", "size, alpha coverage, bbox, colour count", "inputs")
    q = image_cmd("cutout", "flat background -> transparent (border flood fill)")
    q.add_argument("--tol", type=int, default=28, help="colour distance to the background (0-255 per channel)")
    q.add_argument("--bg", help="background colour hex (default: corners)")
    q.add_argument("--grey", type=int, help="also clear light greys (soft shadows) with min channel >= this")
    q.add_argument("--spread", type=int, default=24)
    q.add_argument("--holes", action="store_true", help="also clear enclosed background-coloured areas")
    q.add_argument("--keep-top", type=float, default=1.0, help="keep this fraction from the top (drop a floor shadow)")
    q = image_cmd("fit", "trim + scale into a WxH frame (nearest neighbour)")
    q.add_argument("--size", required=True)
    q.add_argument("--anchor", default="center", choices=["center", "bottom", "top"])
    q.add_argument("--smooth", action="store_true", help="Lanczos instead of nearest (painted/HD art)")
    q.add_argument("--no-upscale", action="store_true")
    q.add_argument("--hard-alpha", action="store_true")
    q = image_cmd("pixelate", "downscale to true pixel art with a limited palette")
    q.add_argument("--size", required=True)
    q.add_argument("--colors", type=int, default=16, help="0 = keep all colours")
    q.add_argument("--outline", action="store_true")
    q.add_argument("--outline-color", default="#141018")
    q = image_cmd("palette", "snap colours to a reference sprite's palette")
    q.add_argument("--from", required=True)
    q.add_argument("--max-colors", type=int, default=64)
    q = cmd("sheet", "pack frames into a sheet", "output", "frames")
    q.add_argument("--cols", type=int)
    q.add_argument("--pad", type=int, default=0)
    q.add_argument("--vertical", action="store_true", help="one column (Terraria NPC/projectile strips)")
    q = cmd("slice", "split a sheet into frames", "input", "outdir")
    q.add_argument("--frame", required=True, help="WxH")
    q.add_argument("--pad", type=int, default=0)
    q = cmd("frames", "make a small idle animation from one frame", "input", "outdir")
    q.add_argument("--n", type=int, default=3)
    q.add_argument("--kind", default="bob", choices=["bob", "squash", "wobble", "flash"])
    q = image_cmd("team-mask", "player-colour mask from a saturated accent colour")
    q.add_argument("--hue", default="blue", choices=["blue", "red", "green", "magenta"])
    image_cmd("seamless", "make a texture tile").add_argument("--blend", type=float, default=0.25)
    image_cmd("tile-preview", "NxN tiled preview").add_argument("--n", type=int, default=3)
    image_cmd("preview", "checkerboard + nearest scale-up for viewing").add_argument("--scale", type=int, default=4)
    image_cmd("outline", "1px outline").add_argument("--color", default="#141018")
    image_cmd("hard-alpha", "binary alpha").add_argument("--thresh", type=int, default=128)
    image_cmd("flip", "mirror horizontally (or --vertical)").add_argument("--vertical", action="store_true")
    image_cmd("rotate", "rotate by degrees (counter-clockwise), nearest").add_argument("degrees", type=float)
    return p


if __name__ == "__main__":
    main(parser().parse_args())
