"""One-time preparation of globe textures (Home) from CGI Moon Kit files.

Usage:  python -I web/scripts/prepare-moon-assets.py [tiff_directory]
Default source directory: ~/Downloads. TIFF files are not copied into the repository.

Output (web/public/assets/):
  moon_4k.jpg   – color map, equirectangular 4096x2048, RGB, quality 85
  moon_disp.jpg – height map 2048x1024, grayscale, quality 90 (only if
                  the sources include a GLOBAL 2:1 equirectangular map; otherwise skipped)
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # NASA maps exceed Pillow's default limit

COLOR_SIZE = (4096, 2048)
DISP_SIZE = (2048, 1024)
OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "assets"


def find(src: Path, prefix: str) -> list[tuple[Path, tuple[int, int]]]:
    """TIFF files whose names start with prefix (case-insensitive)."""
    found = []
    for p in sorted(src.iterdir()):
        if not p.is_file() or p.suffix.lower() not in (".tif", ".tiff"):
            continue
        if not p.name.lower().startswith(prefix):
            continue
        try:
            with Image.open(p) as im:  # lazy: reads only the header
                found.append((p, im.size))
        except Exception as e:  # corrupt / unsupported files do not interrupt processing
            print(f"  skipping {p.name}: {e}")
    return found


def is_equirect(size: tuple[int, int]) -> bool:
    w, h = size
    return h > 0 and abs(w / h - 2.0) < 0.01


def pick_color(src: Path) -> Path | None:
    cands = [(p, s) for p, s in find(src, "lroc_color") if is_equirect(s)]
    exact = [p for p, s in cands if s[0] == COLOR_SIZE[0]]
    if exact:
        return exact[0]
    smaller = sorted(((s[0], p) for p, s in cands if s[0] <= COLOR_SIZE[0]), reverse=True)
    return smaller[0][1] if smaller else None


def pick_disp(src: Path) -> Path | None:
    cands = find(src, "ldem")
    ok = [(s[0], p) for p, s in cands if is_equirect(s)]
    for p, s in cands:
        if not is_equirect(s):
            print(f"  skipping {p.name}: {s[0]}x{s[1]} is not a global 2:1 map "
                  "(e.g. a polar section in stereographic projection)")
    if not ok:
        return None
    # smallest sufficient image (>= target width), falling back to the largest
    enough = sorted(x for x in ok if x[0] >= DISP_SIZE[0])
    return enough[0][1] if enough else sorted(ok)[-1][1]


def make_color(path: Path) -> Path:
    with Image.open(path) as im:
        rgb = im.convert("RGB")
    if rgb.size != COLOR_SIZE:
        rgb = rgb.resize(COLOR_SIZE, Image.LANCZOS)
    out = OUT_DIR / "moon_4k.jpg"
    rgb.save(out, "JPEG", quality=85, optimize=True)
    return out


def make_disp(path: Path) -> Path:
    with Image.open(path) as im:
        if im.mode in ("F", "I;16", "I;16L", "I;16B", "I"):
            arr = np.asarray(im, dtype=np.float32)
        else:
            arr = np.asarray(im.convert("L"), dtype=np.float32)
    lo, hi = np.nanpercentile(arr, [1, 99])
    if hi <= lo:
        hi = lo + 1.0
    norm = np.clip((np.nan_to_num(arr, nan=lo) - lo) / (hi - lo), 0.0, 1.0)
    img = Image.fromarray((norm * 255.0 + 0.5).astype(np.uint8), mode="L")
    img = img.resize(DISP_SIZE, Image.LANCZOS)
    out = OUT_DIR / "moon_disp.jpg"
    img.save(out, "JPEG", quality=90, optimize=True)
    return out


def main() -> int:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Downloads"
    if not src.is_dir():
        print(f"Missing source directory: {src}")
        return 1
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    color = pick_color(src)
    if color is None:
        print(f"No matching lroc_color*.tif (2:1, <= {COLOR_SIZE[0]} px) in {src}")
        return 1
    out = make_color(color)
    print(f"color:  {color.name} -> {out.name} ({out.stat().st_size / 1e6:.2f} MB)")

    disp = pick_disp(src)
    if disp is None:
        print("relief: no global height map (ldem*.tif), skipping moon_disp.jpg")
    else:
        out = make_disp(disp)
        print(f"relief: {disp.name} -> {out.name} ({out.stat().st_size / 1e6:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
