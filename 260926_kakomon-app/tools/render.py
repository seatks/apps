"""問題PDFの各ページを、書き起こし用の座標グリッド付きPNGにする。

使い方: python tools/render.py 2025r07a 2025A
出力:   tools/work/<回ID>/pNN.png（座標はPDFのpt単位。グリッドは50ptごと）
"""
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent
DPI = 150
GRID = 50


def main(pdf_stem, exam_id):
    doc = pymupdf.open(ROOT / "pdf" / f"{pdf_stem}_ap_am_qs.pdf")
    out = ROOT / "work" / exam_id
    out.mkdir(parents=True, exist_ok=True)
    for i, page in enumerate(doc):
        w, h = page.rect.width, page.rect.height
        shape = page.new_shape()
        for x in range(GRID, int(w), GRID):
            shape.draw_line((x, 0), (x, h))
        for y in range(GRID, int(h), GRID):
            shape.draw_line((0, y), (w, y))
        shape.finish(color=(1, 0.6, 0.6), width=0.3)
        shape.commit()
        for x in range(GRID, int(w), GRID):
            page.insert_text((x + 1, 8), str(x), fontsize=6, color=(0.9, 0, 0))
        for y in range(GRID, int(h), GRID):
            page.insert_text((1, y - 1), str(y), fontsize=6, color=(0.9, 0, 0))
        page.get_pixmap(dpi=DPI).save(out / f"p{i:02d}.png")
    print(f"{doc.page_count} pages -> {out}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
