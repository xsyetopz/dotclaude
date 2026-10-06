"""The sprite cases of `tests/test_um.py` from universal-modder, plus the cases for fixed defects."""
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).parents[3] / "plugins" / "dotclaude-modder" / "um" / "py"))
import sprite  # noqa: E402


def sprite_on_white(w=64, h=48):
    im = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    for x in range(20, 40):
        for y in range(10, 30):
            im.putpixel((x, y), (200, 30, 30, 255))
    im.putpixel((30, 20), (255, 255, 255, 255))   # an interior white "eye" must survive
    return im


def test_cutout_keeps_interior_white():
    out = sprite.cutout(sprite_on_white())
    assert out.size == (20, 20)
    assert out.getpixel((10, 10))[3] == 255          # the interior white pixel is still opaque
    assert out.getpixel((0, 0))[:3] == (200, 30, 30)


def test_fit_and_hard_alpha():
    f = sprite.fit(sprite.cutout(sprite_on_white()), 10, 10, anchor="bottom")
    assert f.size == (10, 10) and f.getbbox()[3] == 10
    assert {v for _, v in sprite.hard_alpha(f).getchannel("A").getcolors()} <= {0, 255}


def test_sheet_slice_roundtrip():
    frames = [Image.new("RGBA", (8, 8), (i * 40, 0, 0, 255)) for i in range(5)]
    sh = sprite.sheet(frames, cols=3)
    assert sh.size == (24, 16)
    assert len(sprite.slice_sheet(sh, 8, 8)) == 5


@pytest.mark.parametrize("alpha", [1, 64, 128, 192, 254, 255])
@pytest.mark.parametrize("operation", ["fit", "sheet", "squash"])
def test_sprite_placement_preserves_rgba(alpha, operation):
    # Placing a frame on a transparent canvas must not apply its alpha twice.
    im = Image.new("RGBA", (8, 8), (200, 100, 50, alpha))
    if operation == "fit":
        out = sprite.fit(im, 8, 8)
    elif operation == "sheet":
        out = sprite.slice_sheet(sprite.sheet([im]), 8, 8)[0]
    else:
        out = sprite.simple_frames(im, n=1, kind="squash")[0]
    assert out.tobytes() == im.tobytes()


def test_team_mask():
    im = Image.new("RGBA", (4, 1), (0, 0, 0, 255))
    im.putpixel((0, 0), (20, 60, 240, 255))            # saturated blue -> player colour
    im.putpixel((1, 0), (200, 200, 200, 255))          # grey stays
    rgb, mask = sprite.team_mask(im)
    assert mask.getpixel((0, 0)) > 200 and mask.getpixel((1, 0)) == 0


def test_seamless_edges_match():
    import numpy as np
    ramp = np.tile(np.linspace(0, 255, 64)[None, :, None], (64, 1, 4)).astype(np.uint8)   # huge seam at the wrap
    ramp[..., 3] = 255
    out = np.asarray(sprite.seamless(Image.fromarray(ramp))).astype(int)
    before = np.abs(ramp[:, 0, :3].astype(int) - ramp[:, -1, :3].astype(int)).mean()
    after = np.abs(out[:, 0, :3] - out[:, -1, :3]).mean()
    assert before > 200 and after < 12


# Defects fixed in the port.


def test_flash_keeps_alpha():
    im = Image.new("RGBA", (2, 1), (100, 100, 100, 0))
    im.putpixel((1, 0), (100, 100, 100, 100))
    flash = sprite.simple_frames(im, n=2, kind="flash")[1]
    assert [flash.getpixel((x, 0))[3] for x in (0, 1)] == [0, 100]
    assert flash.getpixel((1, 0))[0] > 100


def test_tiny_image_corner_colour():
    assert sprite.border_color(Image.new("RGBA", (2, 2), (9, 8, 7, 255))) == (9, 8, 7)


def test_empty_palette_reference_is_an_error():
    with pytest.raises(SystemExit):
        sprite.palette_from(Image.new("RGBA", (2, 2)))


def test_bad_colour_is_an_error():
    with pytest.raises(SystemExit):
        sprite._color("#12")
