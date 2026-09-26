"""書き起こし（overrides/<回ID>/*.json）と解答PDFから、アプリ用の問題データを作る。

使い方: python tools/build.py 2025r07a 2025A
  - 解答PDFから正解と分野を読み取る
  - 図を原本のPDFから切り出して img/<回ID>/NNN-k.png に保存する
  - data/<回ID>.json を書き出し、data/index.json に回を登録する
  - check.html 用に、グリッドなしのページ画像を tools/work/<回ID>/plain/ に保存する
既存の explanation / references / needsReview は上書きせずに引き継ぐ。
"""
import json
import re
import sys
from pathlib import Path

import pymupdf

TOOLS = Path(__file__).resolve().parent
APP = TOOLS.parent
FIG_DPI = 200
PLAIN_DPI = 110
FIELDS = {"Ｔ": "technology", "Ｍ": "management", "Ｓ": "strategy"}
SEASONS = {"h": ("春期", "春"), "a": ("秋期", "秋")}


def exam_labels(pdf_stem):
    m = re.fullmatch(r"(\d{4})r(\d{2})([ha])", pdf_stem)
    reiwa, (season, short) = int(m.group(2)), SEASONS[m.group(3)]
    return f"令和{reiwa}年度 {season}", f"R{reiwa}{short}"


def read_answers(pdf_stem):
    text = pymupdf.open(TOOLS / "pdf" / f"{pdf_stem}_ap_am_ans.pdf")[0].get_text()
    rows = re.findall(r"問(\d+)\s*\n\s*([アイウエ])\s*\n\s*([ＴＭＳ])", text)
    answers = {int(n): (a, FIELDS[f]) for n, a, f in rows}
    if sorted(answers) != list(range(1, 81)):
        sys.exit(f"解答PDFから80問分を読み取れませんでした: {sorted(answers)}")
    return answers


def load_transcripts(exam_id):
    items = []
    for f in sorted((TOOLS / "overrides" / exam_id).glob("*.json")):
        items += json.loads(f.read_text(encoding="utf-8"))
    return sorted(items, key=lambda q: q["number"])


def main(pdf_stem, exam_id):
    label, short = exam_labels(pdf_stem)
    answers = read_answers(pdf_stem)
    doc = pymupdf.open(TOOLS / "pdf" / f"{pdf_stem}_ap_am_qs.pdf")

    out_json = APP / "data" / f"{exam_id}.json"
    previous = {}
    if out_json.exists():
        previous = {q["id"]: q for q in json.loads(out_json.read_text(encoding="utf-8"))}

    img_dir = APP / "img" / exam_id
    img_dir.mkdir(parents=True, exist_ok=True)
    for old in img_dir.glob("*.png"):
        old.unlink()

    questions = []
    for t in load_transcripts(exam_id):
        n = t["number"]
        qid = f"{exam_id}-{n:03d}"
        figures = []
        for k, fig in enumerate(t["figures"], 1):
            path = f"img/{exam_id}/{n:03d}-{k}.png"
            clip = pymupdf.Rect(fig["rect"])
            doc[fig["page"]].get_pixmap(dpi=FIG_DPI, clip=clip).save(APP / path)
            figures.append(path)
        prev = previous.get(qid, {})
        answer, field = answers[n]
        questions.append({
            "id": qid,
            "exam": label,
            "number": n,
            "field": field,
            "question": t["question"],
            "figures": figures,
            "choices": t["choices"],
            "answer": answer,
            "explanation": prev.get("explanation", ""),
            "references": prev.get("references", []),
            "needsReview": prev.get("needsReview", t.get("needsReview", False)),
            "pages": t["pages"],
        })

    out_json.write_text(json.dumps(questions, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    index_path = APP / "data" / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else []
    index = [e for e in index if e["id"] != exam_id]
    index.append({"id": exam_id, "label": label, "short": short, "file": f"data/{exam_id}.json"})
    index.sort(key=lambda e: e["id"], reverse=True)
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    plain = TOOLS / "work" / exam_id / "plain"
    plain.mkdir(parents=True, exist_ok=True)
    for p in sorted({p for q in questions for p in q["pages"]}):
        doc[p].get_pixmap(dpi=PLAIN_DPI).save(plain / f"p{p:02d}.png")

    print(f"{len(questions)} questions -> {out_json.relative_to(APP)}, "
          f"{sum(len(q['figures']) for q in questions)} figures")


if __name__ == "__main__":
    main(*sys.argv[1:3])
