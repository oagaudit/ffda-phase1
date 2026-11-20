"""การคำนวณสรุป/เจาะลึก (drill-down) และ pivot สำหรับ view builder
มีกลไกคุ้มครองข้อมูลตามโหมดผู้ใช้:
 - overview : เห็นเฉพาะค่าสรุป ไม่เห็นชื่อหน่วยงาน กลุ่มเล็กกว่า min_group_size ถูกปกปิด
 - public   : เหมือน overview + ค้นหาดูผลรวม/รายด้านของ อปท. ตนเองได้ (ถ้าเปิดใช้)
 - officer/admin : เห็นทุกอย่าง
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from ..reference import ORG_TYPE_ORDER

LEVEL_COLS = {
    "region": ("region", "region"),
    "province": ("province", "province"),
    "district": ("district", "district"),
    "amp": ("amp_code", "amp_name"),          # อำเภอตามรหัสแผนที่
    "tam": ("tam_code", "tam_name"),          # ตำบลตามรหัสแผนที่
    "org_type": ("org_type", "org_type"),
    "grade": ("grade", "grade"),
    "year": ("year", "year"),
    "org": ("org_code", "name"),
}
STAFF_ONLY_DIMS = {"org", "tam"}

MEASURES = {
    "count": ("จำนวนหน่วยงานที่ส่ง", None),
    "avg_total": ("คะแนนรวมเฉลี่ย", "total"),
    "avg_q_pct": ("คะแนนแบบประเมินเฉลี่ย (%)", "q_pct"),
    "avg_lpa10": ("คะแนน LPA เฉลี่ย (เต็ม 10)", "lpa10"),
    "avg_fin50": ("คะแนนรายงานการเงินเฉลี่ย (เต็ม 50)", "fin50"),
    "avg_p1": ("ด้านรายได้ (%)", "p1_pct"),
    "avg_p2": ("ด้านรายจ่าย (%)", "p2_pct"),
    "avg_p3": ("ด้านจัดซื้อจัดจ้าง/พัสดุ (%)", "p3_pct"),
    "avg_p4": ("ด้านบัญชี/รายงาน/ตรวจสอบ (%)", "p4_pct"),
    "median_total": ("คะแนนรวม (มัธยฐาน)", "total"),
    "min_total": ("คะแนนรวมต่ำสุด", "total"),
    "pct_low": ("% หน่วยงานระดับต้องปรับปรุง", None),
    "submission_rate": ("อัตราการส่งแบบประเมิน (%)", None),
}
STAFF_ONLY_MEASURES = {"min_total"}


def clean(v):
    if v is None:
        return None
    if isinstance(v, (float, np.floating)):
        return None if math.isnan(v) else round(float(v), 2)
    if isinstance(v, (np.integer,)):
        return int(v)
    return v


def apply_filters(df: pd.DataFrame, f: dict) -> pd.DataFrame:
    for key in ("region", "province", "district", "org_type", "grade", "amp_code", "tam_code"):
        v = f.get(key)
        if v:
            vals = v if isinstance(v, list) else [x for x in str(v).split(",") if x]
            df = df[df[key].isin(vals)]
    return df


def measure(g: pd.DataFrame, m: str, low_label: str | None = None, base: pd.DataFrame | None = None):
    if m == "count":
        return len(g)
    if m == "pct_low":
        return (g["grade"] == low_label).mean() * 100 if len(g) else None
    if m == "median_total":
        return g["total"].median()
    if m == "min_total":
        return g["total"].min()
    if m == "submission_rate":
        return None  # คำนวณแยก (ต้องใช้ทะเบียน อปท.)
    col = MEASURES[m][1]
    return g[col].mean() if col in g else None


def submission_rates(year_df: pd.DataFrame, orgs: pd.DataFrame, dim: str) -> dict:
    if dim not in ("region", "province", "district", "org_type", "amp_code", "tam_code") or orgs.empty:
        return {}
    tot = orgs.groupby(dim).size()
    sub = year_df.groupby(dim).size()
    return {k: (sub.get(k, 0) / v * 100 if v else None) for k, v in tot.items()}


def sort_key(dim: str, key):
    if dim == "org_type" and key in ORG_TYPE_ORDER:
        return (0, ORG_TYPE_ORDER.index(key))
    return (1, str(key))
