"""แคชข้อมูลรายปีไว้ในหน่วยความจำ (ข้อมูล ~7,000 แถว/ปี ใช้ pandas คำนวณได้เร็วมาก)
ล้างแคชทุกครั้งที่นำเข้าข้อมูลหรือแก้ค่าตั้งค่า"""
import threading

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Answer, Assessment, Organization, Province

_lock = threading.Lock()
_frames: dict = {}


def invalidate():
    with _lock:
        _frames.clear()


def assessments_df(db: Session) -> pd.DataFrame:
    """ผลประเมินทุกปี + ข้อมูล อปท. + จังหวัด/ภูมิภาค (1 แถว ต่อ อปท. ต่อ ปี)"""
    with _lock:
        if "a" in _frames:
            return _frames["a"]
    q = (select(Assessment.__table__, Organization.name, Organization.org_type, Organization.district,
                Organization.province_code, Organization.oag_code, Organization.amp_code, Organization.tam_code,
                Province.name_th.label("province"), Province.region)
         .join(Organization, Organization.code == Assessment.org_code)
         .join(Province, Province.code == Organization.province_code, isouter=True))
    df = pd.read_sql(q, db.bind)
    for p in (1, 2, 3, 4):
        df[f"p{p}_pct"] = (df[f"p{p}"] / df[f"p{p}_max"].where(df[f"p{p}_max"] > 0)) * 100
    df["province"] = df["province"].fillna("ไม่ระบุ")
    df["region"] = df["region"].fillna("ไม่ระบุ")
    _add_geo_names(df)
    with _lock:
        _frames["a"] = df
    return df


def orgs_df(db: Session) -> pd.DataFrame:
    """ทะเบียน อปท. ทั้งหมด (ใช้หาจำนวนที่ยังไม่ส่งแบบประเมิน)"""
    with _lock:
        if "o" in _frames:
            return _frames["o"]
    q = (select(Organization.code, Organization.name, Organization.org_type, Organization.district,
                Organization.province_code, Organization.amp_code, Organization.tam_code,
                Province.name_th.label("province"), Province.region)
         .join(Province, Province.code == Organization.province_code, isouter=True)
         .where(Organization.active.is_(True)))
    df = pd.read_sql(q, db.bind)
    _add_geo_names(df)
    with _lock:
        _frames["o"] = df
    return df


def answers_df(db: Session, year: int) -> pd.DataFrame:
    key = ("ans", year)
    with _lock:
        if key in _frames:
            return _frames[key]
    q = (select(Answer.q_no, Answer.item_key, Answer.score, Answer.max_score, Assessment.org_code, Assessment.form_group)
         .join(Assessment, Assessment.id == Answer.assessment_id).where(Assessment.year == year))
    df = pd.read_sql(q, db.bind)
    df["ratio"] = df["score"] / df["max_score"].where(df["max_score"] > 0)
    with _lock:
        _frames[key] = df
    return df


def item_answers_df(db: Session, item_key: str) -> pd.DataFrame:
    """คะแนนของตัวชี้วัดเดียวทุกปี (ใช้แนวโน้มรายข้อข้ามปี)"""
    q = (select(Assessment.year, Assessment.org_code, Answer.score, Answer.max_score)
         .join(Assessment, Assessment.id == Answer.assessment_id).where(Answer.item_key == item_key))
    df = pd.read_sql(q, db.bind)
    df["ratio"] = df["score"] / df["max_score"].where(df["max_score"] > 0)
    return df


def _add_geo_names(df: pd.DataFrame):
    """ชื่ออำเภอ/ตำบลตามแผนที่ (ใช้เป็นป้ายของระดับ amp/tam)"""
    from .geo import amp_name, tam_name
    df["amp_name"] = [amp_name(c) or d or "ไม่ระบุ" for c, d in zip(df["amp_code"], df["district"])]
    df["tam_name"] = [tam_name(c) or "ไม่ระบุตำบล" for c in df["tam_code"]]
    df["amp_code"] = df["amp_code"].fillna("ไม่ระบุ")
    df["tam_code"] = df["tam_code"].fillna("ไม่ระบุ")
