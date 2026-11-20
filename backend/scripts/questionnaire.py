"""จัดการโครงสร้างแบบประเมินผ่าน command line (ทำได้เหมือนหน้าเว็บ “โครงสร้างแบบประเมิน”)

    # 1) เทียบไฟล์ปีใหม่กับปีก่อน → บันทึกเป็น "ร่าง" + พิมพ์สรุปการเปลี่ยนแปลง
    python -m scripts.questionnaire propose --year 2570 --file ../sample-data/2570.xlsx
    # 2) (แนะนำ) เปิดหน้าเว็บตรวจรายข้อ/แก้ชื่อย่อ/คะแนนเต็ม แล้วกดอนุมัติ — หรืออนุมัติจาก CLI:
    python -m scripts.questionnaire approve --year 2570
    # ดูตารางเทียบข้อคำถามทุกปี
    python -m scripts.questionnaire crosswalk
"""
import argparse
from pathlib import Path

from app.db import SessionLocal
from app.main import init_db
from app.services import questionnaire as qs
from app.models import Questionnaire


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["propose", "approve", "crosswalk"])
    ap.add_argument("--year", type=int)
    ap.add_argument("--file")
    a = ap.parse_args()
    init_db()
    with SessionLocal() as db:
        if a.action == "propose":
            keys = {x["key"] for q in db.query(Questionnaire) for x in q.definition["questions"]}
            p = qs.propose(db, Path(a.file), a.year, keys)
            qs.save_draft(db, a.year, p["definition"], p["base_year"], p["removed"], "cli")
            print(f"เทียบกับปี {p['base_year']}: {p['diff']}")
            for q in p["definition"]["questions"]:
                if q["change"] != "same" or q.get("needs_review"):
                    print(f"  ข้อ {q['q']:>2} {q['key']:<7} {qs.CHANGE_LABEL[q['change']]:<24} "
                          f"(เดิมข้อ {q['base_q']}, คล้าย {q['similarity']}) {q.get('needs_review') or ''}")
            for r in p["removed"]:
                print(f"  ยกเลิก  {r['key']:<7} เดิมข้อ {r['q']} {r['short']}")
            if p["missing_columns"]:
                print("  ⚠ ไม่พบคอลัมน์:", p["missing_columns"])
            print("บันทึกเป็นร่างแล้ว — ตรวจแล้วอนุมัติ: python -m scripts.questionnaire approve --year", a.year)
        elif a.action == "approve":
            q, warns = qs.approve(db, a.year, "cli")
            print(f"อนุมัติโครงสร้างแบบประเมินปี {a.year} แล้ว", warns or "")
        else:
            cw = qs.crosswalk(db)
            ys = [y["year"] for y in cw["years"]]
            print("รหัส     " + "  ".join(f"{y:>6}" for y in ys) + "  ชื่อย่อ")
            for it in cw["items"]:
                cells = []
                for y in ys:
                    c = it["years"].get(y)
                    cells.append("     -" if not c else "  ยกเลิก" if c["change"] == "removed"
                                 else f"{c['q']:>4}{'*' if c['change'] in ('changed', 'new') else ' '} ")
                print(f"{it['key']:<8} " + " ".join(cells) + f"  {it['short']}")
            print("* = ข้อใหม่/เปลี่ยนสาระ (เทียบแนวโน้มกับปีก่อนหน้าไม่ได้)")


if __name__ == "__main__":
    main()
