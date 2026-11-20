"""นำเข้าไฟล์ Excel ผลการประเมินรายปี

ขั้นตอน: ใช้ "โครงสร้างแบบประเมินที่อนุมัติแล้ว" ของปีนั้น -> อ่านไฟล์ -> ตรวจสอบคอลัมน์ -> ทำความสะอาด
        -> ตรวจความถูกต้องของคะแนน -> (ถ้ามี) ปรับปรุงทะเบียน อปท. จากชีตรายชื่อ -> ลบข้อมูลปีเดิม
        -> บันทึกใหม่ทั้งปี (พร้อมรหัสตัวชี้วัด item_key) -> คำนวณระดับผล -> บันทึกประวัติการนำเข้า

การนำเข้าซ้ำปีเดิม = แทนที่ทั้งปี (idempotent) จึงแก้ไฟล์แล้วนำเข้าใหม่ได้เสมอ
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from sqlalchemy import delete, insert, select
from sqlalchemy.orm import Session

from ..models import (Answer, Assessment, AssessmentYear, ImportBatch, Organization,
                      Province, Question)
from ..reference import ORG_TYPE_BY_PREFIX
from . import cache
from .settings_store import get_settings

class ImportError_(Exception):
    pass


def load_mapping(db: Session, year: int) -> dict:
    """โครงสร้างแบบประเมินของปีนั้น (ต้องอนุมัติแล้ว) — ดู services/questionnaire.py"""
    from .questionnaire import QuestionnaireError, approved_definition
    try:
        return approved_definition(db, year)
    except QuestionnaireError as e:
        raise ImportError_(str(e)) from e


def _norm(s) -> str:
    return re.sub(r"\s+", " ", str(s).replace("\xa0", " ")).strip()


def _read_sheet(path: Path, mapping: dict) -> tuple[pd.DataFrame, str]:
    xls = pd.ExcelFile(path)
    required = _norm(mapping["columns"]["org_code"])
    candidates = mapping.get("sheet_candidates", []) + [s for s in xls.sheet_names]
    for sheet in dict.fromkeys(candidates):
        if sheet not in xls.sheet_names:
            continue
        head = pd.read_excel(xls, sheet_name=sheet, header=None, nrows=6, dtype=str)
        for r in range(len(head)):
            if required in [_norm(v) for v in head.iloc[r].tolist()]:
                df = pd.read_excel(xls, sheet_name=sheet, header=r, dtype=object)
                df.columns = [_norm(c) for c in df.columns]
                return df.copy(), sheet
    raise ImportError_(f"ไม่พบชีตที่มีคอลัมน์ '{required}' — ตรวจสอบไฟล์หรือแก้ไฟล์ mapping")


def _num(v):
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return None
    if isinstance(v, str):
        v = v.strip().replace(",", "")
        if v in ("", "-", "NA", "N/A"):
            return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def grade_of(total: float | None, bands: list[dict]) -> str | None:
    if total is None:
        return None
    for b in sorted(bands, key=lambda x: -x["min"]):
        if total >= b["min"]:
            return b["label"]
    return bands[-1]["label"]


def _ensure_reference(db: Session):
    from ..reference import PROVINCES
    if db.query(Province).count() == 0:
        db.execute(insert(Province), [dict(code=c, name_th=t, name_en=e, region=r) for c, t, e, r in PROVINCES])
        db.flush()


def import_master_list(db: Session, df: pd.DataFrame, cfg: dict, prov_by_name: dict) -> int:
    """ปรับปรุงทะเบียน อปท. ทั้งประเทศ (ใช้คำนวณอัตราการส่งแบบประเมิน)"""
    df = df.copy()
    df.columns = [_norm(c) for c in df.columns]
    n = 0
    existing = {o.code: o for o in db.query(Organization).all()}
    for _, r in df.iterrows():
        code = str(r.get(cfg["code"], "")).strip()
        if not re.fullmatch(r"\d{7,8}", code):
            continue
        code = code.zfill(8)
        prov_name = _norm(r.get(cfg["province"], ""))
        org = existing.get(code)
        data = dict(
            name=_norm(r.get(cfg["name_col"], "")),
            org_type=ORG_TYPE_BY_PREFIX.get(code[:2], "อื่น ๆ"),
            district=_norm(r.get(cfg["district"], "")) or None,
            subdistrict=(_norm(r.get(cfg.get("subdistrict", ""), "")) or None) if cfg.get("subdistrict") else None,
            province_code=prov_by_name.get(prov_name) or (code[2:4] if code[2:4] in prov_by_name.values() else None),
        )
        if org:
            for k, v in data.items():
                if v and v != "nan" and k != "name":
                    setattr(org, k, v)
        else:
            # กทม./พัทยา (รูปแบบพิเศษ) ไม่อยู่ในกลุ่มเป้าหมายแบบประเมิน จึงไม่นับเป็นตัวหารอัตราการส่ง
            org = Organization(code=code, active=not code.startswith("01"), **data)
            db.add(org)
            existing[code] = org
        n += 1
    db.flush()
    return n


def import_excel(db: Session, path: Path, year: int, filename: str, username: str | None,
                 dry_run: bool = False) -> dict:
    """นำเข้าผลการประเมินของปี `year` (พ.ศ.) — คืนค่าสรุปผลและคำเตือน"""
    warnings: list[str] = []
    mapping = load_mapping(db, year)
    cols = {k: _norm(v) for k, v in mapping["columns"].items()}
    questions = mapping["questions"]

    _ensure_reference(db)
    prov_by_name = {p.name_th: p.code for p in db.query(Province).all()}

    df, sheet = _read_sheet(path, mapping)
    total_rows = len(df)

    missing = [v for k, v in cols.items() if v not in df.columns and k not in ("oag_code", "submitted_at", "q40")]
    needed_q = {q["col_g1"] for q in questions} | {q["col_g2"] for q in questions}
    missing += [c for c in needed_q if _norm(c) not in df.columns]
    if missing:
        raise ImportError_("ไม่พบคอลัมน์ที่จำเป็น: " + ", ".join(sorted(set(missing))[:15]))

    # ---- ทำความสะอาดรหัส อปท. และตัดแถวซ้ำ (เก็บรายการล่าสุด)
    df["_code"] = df[cols["org_code"]].astype(str).str.strip().str.replace(r"\.0$", "", regex=True)
    bad = ~df["_code"].str.fullmatch(r"\d{7,8}")
    if bad.any():
        warnings.append(f"ข้ามแถวที่รหัส อปท. ไม่ถูกต้อง {int(bad.sum())} แถว")
        df = df[~bad]
    df["_code"] = df["_code"].str.zfill(8)
    if cols.get("submitted_at") in df.columns:
        df["_ts"] = pd.to_datetime(df[cols["submitted_at"]], errors="coerce")
        df = df.sort_values("_ts")
    else:
        df["_ts"] = pd.NaT
    dup = df["_code"].duplicated(keep="last")
    if dup.any():
        warnings.append(f"พบรหัส อปท. ซ้ำ {int(dup.sum())} แถว — ใช้รายการที่ส่งล่าสุด")
        df = df[~dup]

    # ---- คอลัมน์คำตอบ (ข้อความ) อยู่หลังคอลัมน์คะแนนรวม
    answer_cols: dict[int, list[str]] = {}
    after = _norm(mapping.get("answers_after_column", ""))
    if after in df.columns:
        start = list(df.columns).index(after) + 1
        for c in list(df.columns)[start:]:
            m = re.match(r"^คำถามที่\s*(\d+)", c)
            if m:
                answer_cols.setdefault(int(m.group(1)), []).append(c)

    # ---- ทะเบียน อปท. (ถ้าในไฟล์มีชีตรายชื่อทั้งหมด)
    ms = mapping.get("master_sheet")
    if ms:
        try:
            master = pd.read_excel(path, sheet_name=ms["name"], dtype=str)
            n_master = import_master_list(db, master, ms, prov_by_name)
            warnings.append(f"ปรับปรุงทะเบียน อปท. จากชีต '{ms['name']}' จำนวน {n_master:,} แห่ง")
        except ValueError:
            pass

    existing_orgs = {o.code: o for o in db.query(Organization).all()}
    settings = get_settings(db)
    w_q = mapping.get("weights", {}).get("questionnaire", 0.4)

    a_rows, ans_rows = [], []
    mismatch = 0
    unknown_province = set()
    for _, r in df.iterrows():
        code = r["_code"]
        grp = int(_num(r.get(cols["form_group"])) or (2 if code.startswith("02") else 1))
        # คะแนนรายข้อ
        part_score = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}
        part_max = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}
        answers = []
        for q in questions:
            col = _norm(q["col_g1"] if grp == 1 else q["col_g2"])
            mx = float(q["max_g1"] if grp == 1 else q["max_g2"])
            s = _num(r.get(col))
            if s is not None:
                part_score[q["part"]] += s
                part_max[q["part"]] += mx
            texts = [str(r[c]).strip() for c in answer_cols.get(q["q"], [])
                     if pd.notna(r[c]) and str(r[c]).strip() not in ("", "nan")]
            answers.append(dict(q_no=q["q"], item_key=q["key"], score=s, max_score=mx,
                                answer_text=" | ".join(texts) or None))

        q_raw, q_max = sum(part_score.values()), sum(part_max.values())
        q_pct_calc = q_raw / q_max * 100 if q_max else 0.0
        q_pct = _num(r.get(cols["q_pct"]))
        if q_pct is None:
            q_pct = q_pct_calc
        elif abs(q_pct - q_pct_calc) > 0.05:
            mismatch += 1
        lpa = _num(r.get(cols["lpa10"])) or 0.0
        fin = _num(r.get(cols["fin50"])) or 0.0
        total = _num(r.get(cols["total"]))
        if total is None:
            total = q_pct * w_q + lpa + fin

        # ทะเบียน อปท.
        if code not in existing_orgs:
            prov = _norm(r.get(cols["province"], ""))
            pcode = prov_by_name.get(prov) or code[2:4]
            if pcode not in prov_by_name.values():
                unknown_province.add(prov)
                pcode = None
            org = Organization(code=code, oag_code=str(r.get(cols.get("oag_code"), "") or "") or None,
                               name=_norm(r.get(cols["name"], code)),
                               org_type=ORG_TYPE_BY_PREFIX.get(code[:2], "อื่น ๆ"),
                               district=_norm(r.get(cols["district"], "")) or None, province_code=pcode)
            db.add(org)
            existing_orgs[code] = org
        else:
            org = existing_orgs[code]
            oag = r.get(cols.get("oag_code"))
            if oag is not None and pd.notna(oag):
                org.oag_code = str(oag).strip()

        ts = r["_ts"]
        a_rows.append(dict(
            year=year, org_code=code, submitted_at=None if pd.isna(ts) else ts.to_pydatetime(), form_group=grp,
            p1=part_score[1], p2=part_score[2], p3=part_score[3], p4=part_score[4],
            p1_max=part_max[1], p2_max=part_max[2], p3_max=part_max[3], p4_max=part_max[4],
            q_pct=round(q_pct, 4), q40=round(q_pct * w_q, 4), lpa10=lpa, fin50=fin, total=round(total, 4),
            grade=grade_of(total, settings["grade_bands"]),
        ))
        ans_rows.append(answers)

    # ตรวจสอบกับคะแนนรายด้านในไฟล์
    for i, (_, r) in enumerate(df.iterrows()):
        for p in (1, 2, 3, 4):
            v = _num(r.get(cols[f"p{p}"]))
            if v is not None and abs(v - a_rows[i][f"p{p}"]) > 0.05:
                mismatch += 1
                break
    if mismatch:
        warnings.append(f"คะแนนที่ระบบคำนวณจากรายข้อ ไม่ตรงกับคะแนนในไฟล์ {mismatch} แถว (ระบบใช้คะแนนรวมตามไฟล์)")
    if unknown_province:
        warnings.append("ไม่รู้จักชื่อจังหวัด: " + ", ".join(sorted(unknown_province)))

    if dry_run:
        db.rollback()
        return dict(status="dry_run", sheet=sheet, total_rows=total_rows, valid_rows=len(a_rows), warnings=warnings,
                    n_questions=len(questions))

    # ---- บันทึก (แทนที่ข้อมูลทั้งปี)
    y = db.get(AssessmentYear, year)
    if not y:
        y = AssessmentYear(year=year, label=f"ปีงบประมาณ พ.ศ. {year}", status="draft")
        db.add(y)
        db.flush()
    old_ids = select(Assessment.id).where(Assessment.year == year)
    db.execute(delete(Answer).where(Answer.assessment_id.in_(old_ids)))
    db.execute(delete(Assessment).where(Assessment.year == year))
    db.execute(delete(Question).where(Question.year == year))
    db.flush()

    def _qtext(qn):  # ข้อความคำถามฉบับเต็มจากหัวคอลัมน์ในไฟล์ (กรณีนิยามไม่มีข้อความ)
        for c in answer_cols.get(qn, []):
            t = re.sub(r"\.\d+$", "", re.sub(r"^คำถามที่\s*\d+(\.\d+)?\s*", "", c)).strip()
            if len(t) > 20:
                return t
        return None
    db.execute(insert(Question), [dict(year=year, q_no=q["q"], part=q["part"],
                                       text=q.get("text") or _qtext(q["q"]) or q["short"], text_g2=q.get("text_g2"),
                                       short=q["short"], max_g1=q["max_g1"], max_g2=q["max_g2"],
                                       item_key=q["key"], change=q.get("change")) for q in questions])
    db.execute(insert(Assessment), a_rows)
    db.flush()
    id_by_code = dict(db.execute(select(Assessment.org_code, Assessment.id).where(Assessment.year == year)).all())
    flat = []
    for a, answers in zip(a_rows, ans_rows):
        aid = id_by_code[a["org_code"]]
        for x in answers:
            flat.append(dict(assessment_id=aid, **x))
    for i in range(0, len(flat), 20000):
        db.execute(insert(Answer), flat[i:i + 20000])

    from .geo import assign_geo
    geo_info = assign_geo(db)
    warnings.append(f"จับคู่แผนที่: ระดับอำเภอ {geo_info['amp']:,} / ระดับตำบล {geo_info['tam']:,} จาก {geo_info['orgs']:,} แห่ง")
    y.n_records = len(a_rows)
    y.imported_at = datetime.now()
    db.flush()

    batch = ImportBatch(year=year, filename=filename, stored_path=str(path), status="success",
                        total_rows=total_rows, imported_rows=len(a_rows), warnings=warnings, created_by=username)
    db.add(batch)
    db.commit()
    cache.invalidate()
    return dict(status="success", batch_id=batch.id, sheet=sheet, year=year, total_rows=total_rows,
                imported_rows=len(a_rows), warnings=warnings, n_questions=len(questions))
