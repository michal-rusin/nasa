"""Tekstura czapy bieguna południowego dla globusa (Home) z mozaiki LROC WAC.

Użycie:  python web/scripts/prepare-south-pole-texture.py

Wejście:  web/public/assets/south_pole_moon.jpg
  rzut biegunowy stereograficzny (lon 0 u góry, 90°E w prawo, tak jak basemapa zespołu),
  biegun w środku, krawędź = 80°S, 100 m/px (6082 x 6082, skala szarości).
  Ma wypalone jasne linie siatki: południki co 45° przez środek i okrąg 85°S.

Wyjście:  web/public/assets/south_pole_2k.jpg
  2048 x 2048, linie siatki usunięte (zastąpione sąsiednimi pikselami), rozjaśnione gamma 0,55
  (żeby pasowało do jasnej tekstury globusa), quality 88.
  Globus ogląda biegun z odległości ≥ 0,5 R, więc ~300 m/px w zupełności wystarcza,
  a plik ma ~1 MB zamiast 11 MB.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

ROOT = Path(__file__).resolve().parents[1] / 'public' / 'assets'
SRC = ROOT / 'south_pole_moon.jpg'
DST = ROOT / 'south_pole_2k.jpg'
OUT_SIZE = 2048
# Linia siatki: jasna (≥ LINE_MIN) i wyraźnie jaśniejsza od tła obok (o ≥ LINE_DELTA).
LINE_MIN = 90
LINE_DELTA = 35
# Kąty linii siatki w obrazie (wykryte na mozaice: krzyż + przekątne).
MERIDIANS_DEG = (0, 45, 90, 135)
# Mozaika ma zapisane cienie (mediana ~66), tekstura globusa to jasne albedo (mediana ~170 w pasie
# 80–84°S). Krzywa gamma rozjaśnia półcienie i zostawia czerń wiecznych cieni.
GAMMA = 0.55


def main() -> None:
    a = np.asarray(Image.open(SRC).convert('L')).astype(np.float32)
    n = a.shape[0]
    c = (n - 1) / 2
    yy, xx = np.indices(a.shape)
    r = np.hypot(xx - c, yy - c)

    # Okręgi siatki: promienie z najwyższym udziałem jasnych pikseli (poza samym środkiem).
    ri = r.astype(np.int32)
    share = np.bincount(ri.ravel(), (a > 200).ravel()) / np.maximum(1, np.bincount(ri.ravel()))
    share[:40] = 0
    edge = int(np.nonzero(share)[0].max())
    share[edge - 4:] = 0  # sama krawędź obrazu to nie linia siatki
    rings = [int(i) for i in np.nonzero(share > 0.3)[0]]

    out = a.copy()
    # Południki co 45° (0°, 45°, 90°, 135° w obrazie): piksele do 1,5 px od prostej przez środek,
    # tło z pikseli o 4 px w bok (prostopadle do linii).
    for deg in MERIDIANS_DEG:
        t = np.radians(deg)
        dx, dy = np.cos(t), np.sin(t)
        px, py = -dy, dx
        dist = (xx - c) * px + (yy - c) * py
        ys, xs = np.nonzero(np.abs(dist) <= 1.5)
        def side(k: float) -> np.ndarray:
            sy = np.clip(np.round(ys + py * k).astype(int), 0, n - 1)
            sx = np.clip(np.round(xs + px * k).astype(int), 0, n - 1)
            return a[sy, sx]
        bg = (side(-4) + side(4)) / 2
        v = a[ys, xs]
        hit = (v >= LINE_MIN) & (v - bg >= LINE_DELTA)
        out[ys[hit], xs[hit]] = bg[hit]
    # Okręgi: tło z pikseli o 4 px bliżej i dalej od środka (wzdłuż promienia).
    if rings:
        ux = np.where(r > 0, (xx - c) / np.maximum(r, 1e-6), 0)
        uy = np.where(r > 0, (yy - c) / np.maximum(r, 1e-6), 0)
        near = np.zeros(a.shape, bool)
        for rr in rings:
            near |= np.abs(r - rr) <= 2
        ys, xs = np.nonzero(near)
        def sample(k: float) -> np.ndarray:
            sy = np.clip(np.round(ys + uy[ys, xs] * k).astype(int), 0, n - 1)
            sx = np.clip(np.round(xs + ux[ys, xs] * k).astype(int), 0, n - 1)
            return a[sy, sx]
        bg = (sample(-4) + sample(4)) / 2
        v = a[ys, xs]
        hit = (v >= LINE_MIN) & (v - bg >= LINE_DELTA)
        out[ys[hit], xs[hit]] = bg[hit]

    # Poza krawędzią 80°S czarno (i tak przycina to przezroczystość na globusie).
    out[r > edge] = 0
    out = 255.0 * (np.clip(out, 0, 255) / 255.0) ** GAMMA
    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'L')
    img = img.resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS)
    img.save(DST, quality=88, optimize=True)
    print(f'{DST.name}: {OUT_SIZE}px, okręgi siatki r={rings}, krawędź r={edge} z {n}px, '
          f'{DST.stat().st_size / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
