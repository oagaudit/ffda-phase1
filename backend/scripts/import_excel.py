"""นำเข้าไฟล์ Excel ผ่าน command line (ใช้แทนหน้าเว็บได้ เหมาะกับการนำเข้าครั้งแรก)

ตัวอย่าง:
    python -m scripts.import_excel --year 2569 --file "../sample-data/survey_analyst.xlsx"
    python -m scripts.import_excel --year 2569 --file data.xlsx --dry-run   # ตรวจสอบอย่างเดียว ไม่บันทึก
    python -m scripts.import_excel --year 2569 --file data.xlsx --publish   # นำเข้าแล้วเผยแพร่ทันที
"""
import argparse
import json
import time
from datetime import datetime
from pathlib import Path

from app.db import SessionLocal
from app.main import init_db
from app.models import AssessmentYear
from app.services.importer import import_excel


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, required=True, help="ปีงบประมาณ พ.ศ. เช่น 2569")
    ap.add_argument("--file", required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--publish", action="store_true")
    a = ap.parse_args()
    init_db()
    t = time.time()
    with SessionLocal() as db:
        res = import_excel(db, Path(a.file), a.year, Path(a.file).name, "cli", dry_run=a.dry_run)
        if a.publish and not a.dry_run:
            y = db.get(AssessmentYear, a.year)
            y.status, y.published_at = "published", datetime.now()
            db.commit()
    print(json.dumps(res, ensure_ascii=False, indent=2, default=str))
    print(f"เสร็จใน {time.time() - t:.1f} วินาที")


if __name__ == "__main__":
    main()
