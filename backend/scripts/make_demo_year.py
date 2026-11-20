"""สร้างไฟล์ "ปีจำลอง" (เช่น 2570) จากไฟล์ปี 2569 — ใช้ทดสอบระบบหลายปีเท่านั้น ห้ามใช้เป็นข้อมูลจริง

- คะแนนรายข้อเปลี่ยนแบบสุ่มเล็กน้อย แล้วลบคอลัมน์คะแนนรวม ให้ระบบคำนวณใหม่จากรายข้อ
- --change-questions : จำลอง "แบบประเมินปีใหม่เปลี่ยน" เพื่อทดสอบการจัดการโครงสร้างแบบประเมิน
      * ยกเลิกข้อ 30 (การใช้รถส่วนกลาง)  → ข้อ 31-43 เลื่อนเป็น 30-42
      * ข้อ 19 (e-Payment) เปลี่ยนสาระ/เกณฑ์
      * เพิ่มข้อใหม่ท้ายด้าน 4 (ข้อ 43: เปิดเผยรายงานการเงินต่อประชาชน)
      * ทุกข้อเลื่อนปีงบประมาณ 2568 → 2569 (ระบบต้องมองว่า "เหมือนเดิม")

    python -m scripts.make_demo_year --src ../sample-data/2569.xlsx --out ../sample-data/DEMO_2570.xlsx --change-questions
"""
import argparse
import re

import numpy as np
import pandas as pd

NEW_Q_TEXT = ("หน่วยงานของท่านได้เผยแพร่รายงานการเงินประจำปีและรายงานผลการใช้จ่ายงบประมาณให้ประชาชนเข้าถึงได้"
              "ทางเว็บไซต์ของหน่วยงานภายใน 30 วันหลังได้รับรายงานผลการตรวจสอบ หรือไม่")
Q19_NEW = ("ในปีงบประมาณ พ.ศ. 2569 สัดส่วนจำนวนรายการเบิกจ่ายเงินผ่านระบบอิเล็กทรอนิกส์ (e-Payment) "
           "ต่อรายการเบิกจ่ายทั้งหมดของหน่วยงานของท่านเป็นเท่าใด")


def _rename_question_cols(df: pd.DataFrame) -> pd.DataFrame:
    ren = {}
    for c in df.columns:
        s = str(c)
        m = re.match(r"^p(\d)_q(\d+)$", s)
        if m and 31 <= int(m.group(2)) <= 43:
            ren[c] = f"p{m.group(1)}_q{int(m.group(2)) - 1}"
        m = re.match(r"^คำถามที่\s*(\d+)(.*)$", s)
        if m and 31 <= int(m.group(1)) <= 43:
            ren[c] = f"คำถามที่ {int(m.group(1)) - 1}{m.group(2)}"
    return df.rename(columns=ren)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--change-questions", action="store_true")
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    xls = pd.ExcelFile(a.src)
    df = pd.read_excel(xls, sheet_name="Analyst", dtype={"รหัส อปท.": str, "รหัส อปท (สตง.)": str})
    df.columns = [re.sub(r"\s+", " ", str(c).replace("\xa0", " ")).strip() for c in df.columns]
    df = df.sample(frac=0.97, random_state=a.seed)          # บางหน่วยงานไม่ส่งปีถัดไป
    score_cols = [c for c in df.columns if re.match(r"^(g\d_)?p\d_q\d+(_average)?$", str(c))]
    for col in score_cols:
        s = pd.to_numeric(df[col], errors="coerce")
        mx = s.max()
        if not mx or np.isnan(mx):
            continue
        change = rng.choice([-1, 0, 1], size=len(df), p=[0.07, 0.83, 0.10])
        df[col] = np.where(s.isna(), s, np.clip(s + change * mx / 2, 0, mx))
    df["LPA (10%)"] = np.clip(df["LPA (10%)"] + rng.normal(0.1, 0.4, len(df)), 0, 10)
    for c in ["score_p1", "score_p2", "score_p3", "score_p4", "คิดเป็น %", "คะแนนเต็มแบบสอบถาม (40%)",
              "รวมคะแนนทุก part (100%)"]:
        df[c] = np.nan
    df["วันที่ทำรายการ"] = pd.to_datetime(df["วันที่ทำรายการ"]) + pd.DateOffset(years=1)
    # เลื่อนปีงบประมาณในข้อความคำถาม (หัวคอลัมน์)
    df.columns = [re.sub(r"2568", "2569", str(c)) if str(c).startswith("คำถาม") else c for c in df.columns]

    if a.change_questions:
        drop = [c for c in df.columns if re.match(r"^p3_q30$", str(c)) or re.match(r"^คำถามที่\s*30\s", str(c))]
        df = df.drop(columns=drop)
        df = _rename_question_cols(df)
        q19 = next(c for c in df.columns if re.match(r"^คำถามที่\s*19\s", str(c)))
        df = df.rename(columns={q19: f"คำถามที่ 19 {Q19_NEW}"})
        # ข้อใหม่ (คะแนนเต็ม 2): คะแนน + คำตอบ
        new_score = rng.choice([0, 1, 2], size=len(df), p=[0.25, 0.25, 0.5]).astype(float)
        pos = list(df.columns).index("p4_q42") + 1
        df.insert(pos, "p4_q43", new_score)
        df[f"คำถามที่ 43 {NEW_Q_TEXT}"] = np.select(
            [new_score == 2, new_score == 1], ["1. เผยแพร่ครบถ้วนภายในกำหนด", "2. เผยแพร่แต่เกินกำหนด"],
            "3. ไม่ได้เผยแพร่")
    with pd.ExcelWriter(a.out) as w:
        df.to_excel(w, sheet_name="Analyst", index=False)
    print(f"สร้างไฟล์จำลอง {a.out} ({len(df):,} แถว{' · เปลี่ยนข้อคำถาม' if a.change_questions else ''}) — สำหรับทดสอบเท่านั้น")


if __name__ == "__main__":
    main()
