"""API เฉพาะเจ้าหน้าที่ สตง. — router นี้ "ไม่ถูกติดตั้ง" บนเครื่อง public เลย (FFDA_MODE=public)"""
from __future__ import annotations

import io
import re
from collections import defaultdict

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Answer, Assessment, Question
from ..security import Viewer, require_staff
from ..services import analytics as an
from ..services import cache
from .dashboard import filters_from, resolve_year, scoped

router = APIRouter(prefix="/api", tags=["staff"])

@router.get("/watchlist")
def watchlist(request: Request, year: int | None = None, limit: int = 50, db: Session = Depends(get_db),
              v: Viewer = Depends(require_staff)):
    """หน่วยงานที่ควรติดตาม (เชิงพรรณนา ไม่ใช่โมเดล): คะแนนรวมต่ำสุด พร้อมด้านที่อ่อนที่สุด"""
    year = resolve_year(db, v, year)
    df = scoped(db, v, year, filters_from(request, v)).sort_values("total").head(limit)
    names = {1: "รายได้", 2: "รายจ่าย", 3: "พัสดุ", 4: "บัญชี"}
    rows = []
    for r in df.to_dict("records"):
        parts = {p: r[f"p{p}_pct"] for p in (1, 2, 3, 4) if r[f"p{p}_pct"] == r[f"p{p}_pct"]}
        weak = min(parts, key=parts.get) if parts else None
        rows.append(dict(org_code=r["org_code"], name=r["name"], org_type=r["org_type"], district=r["district"],
                         province=r["province"], total=an.clean(r["total"]), grade=r["grade"],
                         fin50=an.clean(r["fin50"]), weakest=f"{names[weak]} {parts[weak]:.0f}%" if weak else None))
    return dict(year=year, rows=rows)


@router.get("/export.csv")
def export_csv(request: Request, year: int | None = None, db: Session = Depends(get_db),
               v: Viewer = Depends(require_staff)):
    year = resolve_year(db, v, year)
    df = scoped(db, v, year, filters_from(request, v))
    cols = {"org_code": "รหัส อปท.", "oag_code": "รหัส สตง.", "name": "ชื่อ อปท.", "org_type": "ประเภท",
            "district": "อำเภอ", "province": "จังหวัด", "region": "ภูมิภาค", "p1_pct": "ด้านรายได้ (%)",
            "p2_pct": "ด้านรายจ่าย (%)", "p3_pct": "ด้านพัสดุ (%)", "p4_pct": "ด้านบัญชี (%)",
            "q_pct": "แบบประเมิน (%)", "q40": "แบบประเมิน (40)", "lpa10": "LPA (10)", "fin50": "รายงานการเงิน (50)",
            "total": "คะแนนรวม", "grade": "ระดับ"}
    buf = io.StringIO()
    df[list(cols)].rename(columns=cols).round(2).to_csv(buf, index=False)
    data = ("﻿" + buf.getvalue()).encode("utf-8")  # BOM ให้ Excel อ่านภาษาไทยถูก
    return StreamingResponse(io.BytesIO(data), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="ffda_{year}.csv"'})


# ------------------------------------------------------------------ รายข้อ: สัดส่วนตัวเลือกคำตอบ
_OPT_SPLIT = re.compile(r",\s*(?=\d+\.\s)")
_OPT_NUM = re.compile(r"^(\d+)\.\s*(.*)$")


@router.get("/questions/{q_no}/options")
def question_options(q_no: int, request: Request, year: int | None = None, group: int | None = None,
                     db: Session = Depends(get_db), v: Viewer = Depends(require_staff)):
    """สัดส่วนตัวเลือกที่ อปท. ตอบ (ในพื้นที่ที่กรอง เทียบทั้งประเทศ) และคะแนนเฉลี่ยของผู้ตอบแต่ละตัวเลือก
    ข้อที่มีหลายรายการย่อย (เช่น ข้อ 1 แผนที่ภาษี/ทะเบียน 3 รายการ) นับทุกรายการรวมกัน"""
    year = resolve_year(db, v, year)
    scope_codes = set(scoped(db, v, year, filters_from(request, v))["org_code"])
    # ข้อ 1-8 แบบประเมินของ อบจ. (group 2) ต่างจาก อบต./เทศบาล (group 1)
    if group is None:
        group = 2 if request.query_params.get("org_type") == "อบจ." else 1
    qry = (db.query(Assessment.org_code, Answer.answer_text, Answer.score, Answer.max_score)
           .join(Answer, Answer.assessment_id == Assessment.id)
           .filter(Assessment.year == year, Answer.q_no == q_no))
    if q_no <= 8:
        qry = qry.filter(Assessment.form_group == group)
    rows = qry.all()
    q = db.query(Question).filter_by(year=year, q_no=q_no).first()

    def tally(sel):
        cnt, score = defaultdict(int), defaultdict(list)
        units = 0
        for code, text, s, mx in sel:
            if not text:
                continue
            for seg in str(text).split(" | "):
                units += 1
                seen = set()
                for opt in _OPT_SPLIT.split(seg.strip()):
                    m = _OPT_NUM.match(opt.strip())
                    key = (int(m.group(1)), m.group(2).strip()) if m else (99, opt.strip())
                    if key in seen or not key[1]:
                        continue
                    seen.add(key)
                    cnt[key] += 1
                    if s is not None and mx:
                        score[key].append(s / mx * 100)
        return units, cnt, score

    nu, ncnt, _ = tally(rows)
    su, scnt, sscore = tally([r for r in rows if r[0] in scope_codes])
    keys = sorted(set(ncnt) | set(scnt))
    return dict(q=q_no, short=q.short if q else "", part=q.part if q else None, units=su, units_national=nu,
                group=group if q_no <= 8 else None,
                multi=any(" | " in (r[1] or "") for r in rows[:200]),
                options=[dict(no=k[0], text=k[1], n=scnt.get(k, 0),
                              pct=an.clean(scnt.get(k, 0) / su * 100) if su else None,
                              pct_national=an.clean(ncnt.get(k, 0) / nu * 100) if nu else None,
                              avg_score_pct=an.clean(sum(sscore[k]) / len(sscore[k])) if sscore.get(k) else None)
                         for k in keys])


# ------------------------------------------------------------------ รายข้อ × พื้นที่ (ตารางความร้อน)
@router.get("/questions/matrix")
def question_matrix(request: Request, level: str = "province", part: int | None = None, year: int | None = None,
                    db: Session = Depends(get_db), v: Viewer = Depends(require_staff)):
    if level not in an.LEVEL_COLS:
        raise HTTPException(400, "level ไม่ถูกต้อง")
    year = resolve_year(db, v, year)
    df = scoped(db, v, year, filters_from(request, v))
    ans = cache.answers_df(db, year)
    qs = {q.q_no: q for q in db.query(Question).filter_by(year=year)}
    qnos = sorted(q for q, x in qs.items() if part is None or x.part == part)
    ans = ans[ans["q_no"].isin(qnos)]
    nat = ans.groupby("q_no")["ratio"].mean() * 100
    key_col, label_col = an.LEVEL_COLS[level]
    cols = list(dict.fromkeys(["org_code", key_col, label_col]))
    m = ans.merge(df[cols].drop_duplicates("org_code"), on="org_code")
    piv = m.groupby([key_col, "q_no"])["ratio"].mean().unstack() * 100
    labels = dict(zip(df[key_col], df[label_col]))
    sizes = df.groupby(key_col).size()
    rows = [dict(key=an.clean(k), label=an.clean(labels.get(k)), n=int(sizes.get(k, 0)),
                 values={str(q): an.clean(r.get(q)) for q in qnos}) for k, r in piv.iterrows()]
    rows.sort(key=lambda r: str(r["label"]))
    return dict(year=year, level=level, questions=[dict(q=q, short=qs[q].short, part=qs[q].part) for q in qnos],
                national={str(q): an.clean(nat.get(q)) for q in qnos}, rows=rows)
