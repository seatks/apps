"""data/<回ID>.json の形式を検査する。

使い方: python tools/validate.py 2025A
"""
import json
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
KANA = ["ア", "イ", "ウ", "エ"]
FIELDS = {"technology", "management", "strategy"}


def validate(exam_id):
    questions = json.loads((APP / "data" / f"{exam_id}.json").read_text(encoding="utf-8"))
    errors = []
    numbers = [q["number"] for q in questions]
    if numbers != list(range(1, 81)):
        errors.append(f"問番号が1〜80の連番ではない: {numbers}")
    for q in questions:
        tag = q["id"]
        if q["id"] != f"{exam_id}-{q['number']:03d}":
            errors.append(f"{tag}: id と問番号が一致しない")
        if not q["question"].strip():
            errors.append(f"{tag}: 問題文が空")
        if q["answer"] not in KANA:
            errors.append(f"{tag}: 正解が不正 ({q['answer']})")
        if q["field"] not in FIELDS:
            errors.append(f"{tag}: 分野が不正 ({q['field']})")
        if q["choices"] is None:
            if not q["figures"]:
                errors.append(f"{tag}: choices が null なのに図がない")
        elif list(q["choices"]) != KANA or not all(v.strip() for v in q["choices"].values()):
            errors.append(f"{tag}: 選択肢がア〜エの4つそろっていない")
        for f in q["figures"]:
            if not (APP / f).is_file():
                errors.append(f"{tag}: 図のファイルがない ({f})")
        for r in q["references"]:
            if not r.get("url", "").startswith("https://"):
                errors.append(f"{tag}: 参考URLが不正 ({r})")
    review = [q["number"] for q in questions if q["needsReview"]]
    explained = sum(1 for q in questions if q["explanation"])
    print(f"{exam_id}: {len(questions)}問, 図 {sum(len(q['figures']) for q in questions)}枚, "
          f"解説あり {explained}問, 要確認 {review or 'なし'}")
    for e in errors:
        print("NG", e)
    return not errors


if __name__ == "__main__":
    sys.exit(0 if validate(sys.argv[1]) else 1)
