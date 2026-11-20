"""ส่งข้อมูลที่ "เผยแพร่แล้ว" จากเครื่อง staff (intranet) ไปยังฐานข้อมูลของเครื่อง public (อินเทอร์เน็ต)

หลักการ: ฐานข้อมูลฝั่ง public มีเฉพาะสิ่งที่ประชาชนเห็นได้ — ต่อให้เครื่อง public ถูกเจาะ ก็ไม่มีข้อมูลลับให้ขโมย
 - ปีที่ยังเป็น "ร่าง"                  → ไม่ส่ง
 - คำตอบข้อความรายข้อ                  → ไม่ส่ง (ส่งเฉพาะคะแนน เพื่อทำสถิติรายข้อแบบภาพรวม)
 - ผลวิเคราะห์ ML/AI (เฟส 2 เก็บแยกตาราง) → ไม่ส่ง
 - ผู้ใช้, มุมมองที่บันทึก, ประวัตินำเข้า    → ไม่ส่ง
ทิศทางเดียว staff → public เท่านั้น (เครื่อง public ไม่มีสิทธิ์เชื่อมกลับเข้า intranet)
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import create_engine, delete, insert, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import Base
from ..models import (Answer, AppSetting, Assessment, AssessmentYear, Organization, Province, Question,
                      Questionnaire)

PUBLIC_SETTING_KEYS = {"grade_bands", "min_group_size", "public_org_lookup"}
HIDDEN_ASSESSMENT_COLS: set[str] = set()   # เผื่ออนาคต: คอลัมน์ที่ห้ามส่งออกไปเครื่อง public


def sync_to_public(db: Session) -> dict:
    if not settings.public_database_url:
        return {"status": "skipped", "message": "ไม่ได้ตั้งค่า PUBLIC_DATABASE_URL (ใช้ฐานข้อมูลเดียวกัน)"}
    eng = create_engine(settings.public_database_url, pool_pre_ping=True)
    Base.metadata.create_all(eng)
    years = [y for y in db.query(AssessmentYear).filter_by(status="published").all()]
    year_ids = [y.year for y in years]
    with eng.begin() as pub:
        # ล้างของเดิมทั้งหมดแล้วเขียนใหม่ (ข้อมูลไม่ใหญ่ ทำแบบนี้ง่ายและถูกต้องที่สุด)
        for t in (Answer, Assessment, Question, Questionnaire, AssessmentYear, Organization, Province, AppSetting):
            pub.execute(delete(t))
        pub.execute(insert(Province), [dict(code=p.code, name_th=p.name_th, name_en=p.name_en, region=p.region)
                                       for p in db.query(Province)])
        pub.execute(insert(Organization), [dict(code=o.code, oag_code=None, name=o.name, org_type=o.org_type,
                                                district=o.district, subdistrict=o.subdistrict,
                                                province_code=o.province_code, amp_code=o.amp_code,
                                                tam_code=o.tam_code, active=o.active)
                                           for o in db.query(Organization)])
        if years:
            pub.execute(insert(AssessmentYear), [dict(year=y.year, label=y.label, status="published",
                                                      n_records=y.n_records, imported_at=y.imported_at,
                                                      published_at=y.published_at) for y in years])
            qcols = [c.name for c in Question.__table__.columns if c.name != "id"]
            pub.execute(insert(Question), [{c: getattr(q, c) for c in qcols}
                                           for q in db.query(Question).filter(Question.year.in_(year_ids))])
            pub.execute(insert(Questionnaire), [dict(year=q.year, status=q.status, base_year=q.base_year,
                                                     definition=q.definition, diff=q.diff, approved_at=q.approved_at)
                                                for q in db.query(Questionnaire).filter(Questionnaire.year.in_(year_ids))])
            cols = [c.name for c in Assessment.__table__.columns if c.name not in HIDDEN_ASSESSMENT_COLS]
            rows = db.execute(select(*[Assessment.__table__.c[c] for c in cols])
                              .where(Assessment.year.in_(year_ids))).mappings().all()
            pub.execute(insert(Assessment), [dict(r) for r in rows])
            ans = db.execute(select(Answer.assessment_id, Answer.q_no, Answer.item_key, Answer.score, Answer.max_score)
                             .join(Assessment, Assessment.id == Answer.assessment_id)
                             .where(Assessment.year.in_(year_ids))).mappings().all()
            ans = [dict(r, answer_text=None) for r in ans]
            for i in range(0, len(ans), 20000):
                pub.execute(insert(Answer), ans[i:i + 20000])
        st = [dict(key=s.key, value=s.value) for s in db.query(AppSetting) if s.key in PUBLIC_SETTING_KEYS]
        if st:
            pub.execute(insert(AppSetting), st)
    eng.dispose()
    return {"status": "success", "years": year_ids, "at": datetime.now().isoformat(timespec="seconds")}
