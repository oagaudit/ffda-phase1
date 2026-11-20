"""API สำหรับแดชบอร์ด (ใช้ร่วมกันทั้ง 3 โหมด — ระบบตัดข้อมูลตามสิทธิ์ให้อัตโนมัติ)"""
from __future__ import annotations

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Answer, Assessment, AssessmentYear, Organization, Province, Question, Questionnaire
from ..reference import ORG_TYPE_ORDER, PARTS
from ..config import settings
from ..security import Viewer, get_viewer
from ..services import analytics as an
from ..services import cache
from ..services import questionnaire as qsvc
from ..services.settings_store import get_settings

router = APIRouter(prefix="/api", tags=["dashboard"])
FILTER_KEYS = ("region", "province", "district", "org_type", "grade", "amp_code", "tam_code")


# ------------------------------------------------------------------ helpers
def visible_years(db: Session, v: Viewer) -> list[int]:
    q = db.query(AssessmentYear).filter(AssessmentYear.n_records > 0)
    if not v.is_staff:
        q = q.filter(AssessmentYear.status == "published")
    return sorted(y.year for y in q.all())


def resolve_year(db: Session, v: Viewer, year: int | None) -> int:
    ys = visible_years(db, v)
    if not ys:
        raise HTTPException(404, "ยังไม่มีข้อมูลที่เผยแพร่" if not v.is_staff else "ยังไม่มีข้อมูล กรุณานำเข้าไฟล์ Excel")
    if year is None:
        return ys[-1]
    if year not in ys:
        raise HTTPException(404, f"ไม่มีข้อมูลปี {year} หรือยังไม่เผยแพร่")
    return year


def filters_from(request: Request, v: Viewer) -> dict:
    f = {k: request.query_params.get(k) for k in FILTER_KEYS if request.query_params.get(k)}
    if not v.is_staff:
        for k in ("tam_code",):
            f.pop(k, None)
    return f


def scoped(db, v, year, f):
    df = cache.assessments_df(db)
    return an.apply_filters(df[df["year"] == year], f)


def scoped_orgs(db, f):
    o = cache.orgs_df(db)
    for k in ("region", "province", "district", "org_type", "amp_code", "tam_code"):
        if f.get(k):
            o = o[o[k].isin(str(f[k]).split(","))]
    return o


def low_label(st):
    return sorted(st["grade_bands"], key=lambda b: b["min"])[0]["label"]


# ------------------------------------------------------------------ meta
@router.get("/meta")
def meta(db: Session = Depends(get_db), v: Viewer = Depends(get_viewer)):
    st = get_settings(db)
    years = visible_years(db, v)
    provinces = [dict(code=p.code, name=p.name_th, name_en=p.name_en, region=p.region)
                 for p in db.query(Province).order_by(Province.code)]
    qyear = years[-1] if years else None
    questions = [dict(q=q.q_no, part=q.part, short=q.short, max_g1=q.max_g1, max_g2=q.max_g2, key=q.item_key,
                      change=q.change)
                 for q in db.query(Question).filter_by(year=qyear).order_by(Question.q_no)] if qyear else []
    dims = [d for d in an.LEVEL_COLS if v.is_staff or d not in an.STAFF_ONLY_DIMS]
    measures = {k: lbl for k, (lbl, _) in an.MEASURES.items() if v.is_staff or k not in an.STAFF_ONLY_MEASURES}
    year_status = {y.year: y.status for y in db.query(AssessmentYear)} if v.is_staff else {}
    return dict(mode=v.mode, username=v.username, full_name=v.full_name, deploy_mode=settings.mode, years=years, latest_year=years[-1] if years else None,
                year_status=year_status, provinces=provinces,
                regions=sorted({p["region"] for p in provinces}), org_types=ORG_TYPE_ORDER[:5],
                parts=PARTS, questions=questions, grade_bands=st["grade_bands"],
                dims=dims, measures=measures, n_questions=len(questions),
                public_org_lookup=st["public_org_lookup"], min_group_size=st["min_group_size"])


# ------------------------------------------------------------------ KPI summary
@router.get("/summary")
def summary(request: Request, year: int | None = None, db: Session = Depends(get_db), v: Viewer = Depends(get_viewer)):
    year = resolve_year(db, v, year)
    f = filters_from(request, v)
    st = get_settings(db)
    df = scoped(db, v, year, f)
    orgs = scoped_orgs(db, f)
    n = len(df)
    suppressed = (not v.is_staff) and n < st["min_group_size"]

    def avg(c):
        return None if suppressed or n == 0 else an.clean(df[c].mean())

    out = dict(year=year, filters=f, n_submitted=n, n_orgs=int(len(orgs)),
               submission_rate=an.clean(n / len(orgs) * 100) if len(orgs) else None, suppressed=suppressed,
               avg_total=avg("total"), median_total=None if suppressed or not n else an.clean(df["total"].median()),
               avg_q_pct=avg("q_pct"), avg_lpa10=avg("lpa10"), avg_fin50=avg("fin50"),
               parts={p: avg(f"p{p}_pct") for p in (1, 2, 3, 4)},
               parts_std={p: None if suppressed or n < 2 else an.clean(df[f"p{p}_pct"].std()) for p in (1, 2, 3, 4)},
               avg_q40=avg("q40"),
               grades={b["label"]: int((df["grade"] == b["label"]).sum()) for b in st["grade_bands"]},
               pct_fin_full=None if suppressed or not n else an.clean((df["fin50"] >= 50).mean() * 100))
    # เทียบกับปีก่อน
    ys = [y for y in visible_years(db, v) if y < year]
    if ys:
        prev = scoped(db, v, ys[-1], f)
        out["prev_year"] = ys[-1]
        out["prev_avg_total"] = an.clean(prev["total"].mean()) if len(prev) else None
    if v.is_staff:
        out["n_fin_not_full"] = int((df["fin50"] < 50).sum())
        out["not_submitted"] = int(len(orgs) - orgs["code"].isin(df["org_code"]).sum())
    return out


# ------------------------------------------------------------------ drill-down breakdown
@router.get("/breakdown")
def breakdown(request: Request, level: str = "province", year: int | None = None,
              db: Session = Depends(get_db), v: Viewer = Depends(get_viewer)):
    if level not in an.LEVEL_COLS:
        raise HTTPException(400, "level ไม่ถูกต้อง")
    if level in an.STAFF_ONLY_DIMS and not v.is_staff:
        raise HTTPException(403, "ระดับรายหน่วยงานสำหรับเจ้าหน้าที่เท่านั้น")
    year = resolve_year(db, v, year)
    f = filters_from(request, v)
    st = get_settings(db)
    df = scoped(db, v, year, f)
    key_col, label_col = an.LEVEL_COLS[level]
    low = low_label(st)

    if level == "org":
        cols = ["org_code", "name", "org_type", "district", "province", "region", "amp_code", "tam_code", "tam_name",
                "total", "q_pct", "q40", "lpa10", "fin50",
                "p1_pct", "p2_pct", "p3_pct", "p4_pct", "grade"]
        rows = df[cols].sort_values("total").to_dict("records")
        return dict(year=year, level=level, rows=[{k: an.clean(x) for k, x in r.items()} for r in rows])

    rates = an.submission_rates(df, scoped_orgs(db, f), key_col)
    bands = [b["label"] for b in st["grade_bands"]]
    rows = []
    for key, g in df.groupby(key_col, dropna=False):
        n = len(g)
        hide = (not v.is_staff) and n < st["min_group_size"]
        r = dict(key=an.clean(key), label=an.clean(g[label_col].iloc[0]), n=n,
                 submission_rate=an.clean(rates.get(key)),
                 avg_total=None if hide else an.clean(g["total"].mean()),
                 median_total=None if hide else an.clean(g["total"].median()),
                 pct_low=None if hide else an.clean((g["grade"] == low).mean() * 100),
                 avg_q_pct=None if hide else an.clean(g["q_pct"].mean()),
                 avg_q40=None if hide else an.clean(g["q40"].mean()),
                 avg_lpa10=None if hide else an.clean(g["lpa10"].mean()),
                 avg_fin50=None if hide else an.clean(g["fin50"].mean()),
                 grades=None if hide else {b: int((g["grade"] == b).sum()) for b in bands},
                 suppressed=hide)
        for p in (1, 2, 3, 4):
            r[f"avg_p{p}"] = None if hide else an.clean(g[f"p{p}_pct"].mean())
        if v.is_staff:
            r["n_low"] = int((g["grade"] == low).sum())
            r["min_total"] = an.clean(g["total"].min())
        rows.append(r)
    rows.sort(key=lambda r: an.sort_key(level, r["key"]))
    return dict(year=year, level=level, rows=rows)


# ------------------------------------------------------------------ distribution & question stats
@router.get("/distribution")
def distribution(request: Request, year: int | None = None, field: str = "total",
                 db: Session = Depends(get_db), v: Viewer = Depends(get_viewer)):
    year = resolve_year(db, v, year)
    if field not in ("total", "q_pct"):
        raise HTTPException(400, "field ไม่ถูกต้อง")
    df = scoped(db, v, year, filters_from(request, v))
    s = df[field].dropna()
    if s.empty:
        return dict(bins=[], counts=[])
    lo = float(np.floor(s.quantile(0.005)))
    hi = 100.0
    width = 1.0
    edges = np.arange(lo, hi + width, width)
    counts, edges = np.histogram(s.clip(lo, hi), bins=edges)
    return dict(field=field, bins=[f"{e:g}" for e in edges[:-1]], counts=counts.tolist(),
                mean=an.clean(s.mean()), median=an.clean(s.median()))


@router.get("/questions/stats")
def question_stats(request: Request, year: int | None = None, db: Session = Depends(get_db),
                   v: Viewer = Depends(get_viewer)):
    year = resolve_year(db, v, year)
    df = scoped(db, v, year, filters_from(request, v))
    ans = cache.answers_df(db, year)
    ans = ans[ans["org_code"].isin(df["org_code"])]
    qs = {q.q_no: q for q in db.query(Question).filter_by(year=year)}
    rows = []
    for q_no, g in ans.groupby("q_no"):
        app = g["ratio"].dropna()
        q = qs.get(q_no)
        rows.append(dict(q=int(q_no), part=q.part if q else None, short=q.short if q else f"ข้อ {q_no}",
                         key=q.item_key if q else None, change=q.change if q else None,
                         n_applicable=int(len(app)), avg_pct=an.clean(app.mean() * 100) if len(app) else None,
                         pct_full=an.clean((app >= 0.999).mean() * 100) if len(app) else None,
                         pct_zero=an.clean((app <= 0.001).mean() * 100) if len(app) else None))
    return dict(year=year, rows=rows)


@router.get("/questions/crosswalk")
def question_crosswalk(db: Session = Depends(get_db), v: Viewer = Depends(get_viewer)):
    """ตารางเทียบข้อคำถามข้ามปี: ข้อใดเหมือนเดิม/ปรับถ้อยคำ/เปลี่ยนสาระ/ข้อใหม่/ยกเลิก"""
    years = None if v.is_staff else visible_years(db, v)
    return qsvc.crosswalk(db, years)


@router.get("/questions/item-trend")
def item_trend(request: Request, key: str, db: Session = Depends(get_db), v: Viewer = Depends(get_viewer)):
    """แนวโน้มของตัวชี้วัดเดียวข้ามปี (ตาม item_key) — ตัดเส้นเมื่อมีการเปลี่ยนสาระ"""
    st = get_settings(db)
    f = filters_from(request, v)
    ys = visible_years(db, v)
    df = an.apply_filters(cache.assessments_df(db), f)
    ans = cache.item_answers_df(db, key)
    qs = {q.year: q for q in db.query(Question).filter(Question.item_key == key, Question.year.in_(ys))}
    if not qs:
        raise HTTPException(404, "ไม่พบตัวชี้วัดนี้")
    rows = []
    for y in ys:
        q = qs.get(y)
        if not q:
            rows.append(dict(year=y, present=False))
            continue
        codes = set(df.loc[df["year"] == y, "org_code"])
        a = ans[(ans["year"] == y) & ans["org_code"].isin(codes)]["ratio"].dropna()
        hide = (not v.is_staff) and len(a) < st["min_group_size"]
        rows.append(dict(year=y, present=True, q=q.q_no, short=q.short, change=q.change, n=int(len(a)),
                         avg_pct=None if hide else an.clean(a.mean() * 100),
                         pct_full=None if hide else an.clean((a >= 0.999).mean() * 100)))
    last = max(qs.values(), key=lambda q: q.year)
    return dict(key=key, short=last.short, part=last.part, text=last.text, rows=rows,
                comparable_since=qsvc.comparable_since(db, key))


@router.get("/trend")
def trend(request: Request, db: Session = Depends(get_db), v: Viewer = Depends(get_viewer)):
    f = filters_from(request, v)
    df = an.apply_filters(cache.assessments_df(db), f)
    ys = visible_years(db, v)
    orgs = scoped_orgs(db, f)
    qn = {q.year: q for q in db.query(Questionnaire).filter(Questionnaire.year.in_(ys))}
    rows = []
    for y in ys:
        g = df[df["year"] == y]
        d = (qn[y].diff or {}) if y in qn else {}
        rows.append(dict(year=y, n=len(g), avg_total=an.clean(g["total"].mean()),
                         n_questions=len(qn[y].definition["questions"]) if y in qn else None,
                         q_changes={k: d.get(k, 0) for k in ("new", "changed", "removed")} if y in qn and qn[y].base_year else None,
                         submission_rate=an.clean(len(g) / len(orgs) * 100) if len(orgs) else None,
                         **{f"avg_p{p}": an.clean(g[f"p{p}_pct"].mean()) for p in (1, 2, 3, 4)}))
    return dict(rows=rows)


# ------------------------------------------------------------------ pivot (view builder)
@router.get("/pivot")
def pivot(request: Request, rows: str = "province", cols: str | None = None, measure: str = "avg_total",
          year: int | None = None, db: Session = Depends(get_db), v: Viewer = Depends(get_viewer)):
    dims = [d for d in (rows, cols) if d]
    for d in dims:
        if d not in an.LEVEL_COLS or (d in an.STAFF_ONLY_DIMS and not v.is_staff):
            raise HTTPException(400, f"มิติ '{d}' ใช้ไม่ได้ในโหมดนี้")
    if measure not in an.MEASURES or (measure in an.STAFF_ONLY_MEASURES and not v.is_staff):
        raise HTTPException(400, f"ตัวชี้วัด '{measure}' ใช้ไม่ได้ในโหมดนี้")
    st = get_settings(db)
    f = filters_from(request, v)
    all_df = an.apply_filters(cache.assessments_df(db), f)
    if "year" in dims:
        df = all_df[all_df["year"].isin(visible_years(db, v))]
    else:
        df = all_df[all_df["year"] == resolve_year(db, v, year)]
    low = low_label(st)
    rk, rl = an.LEVEL_COLS[rows]
    out_rows, col_keys = [], []
    if cols:
        ck = an.LEVEL_COLS[cols][0]
        col_keys = sorted(df[ck].dropna().unique().tolist(), key=lambda k: an.sort_key(cols, k))
    for key, g in df.groupby(rk, dropna=False):
        hide = (not v.is_staff) and len(g) < st["min_group_size"] and measure != "count"
        if cols:
            vals = {}
            for c_key, gg in g.groupby(an.LEVEL_COLS[cols][0]):
                small = (not v.is_staff) and len(gg) < st["min_group_size"] and measure != "count"
                vals[str(an.clean(c_key))] = None if small else an.clean(an.measure(gg, measure, low))
        else:
            vals = {"value": None if hide else an.clean(an.measure(g, measure, low))}
        if measure == "submission_rate" and not cols:
            rates = an.submission_rates(g, scoped_orgs(db, f), rows)
            vals = {"value": an.clean(rates.get(key))}
        out_rows.append(dict(key=an.clean(key), label=an.clean(g[rl].iloc[0]), n=len(g), values=vals))
    out_rows.sort(key=lambda r: an.sort_key(rows, r["key"]))
    return dict(rows=out_rows, col_keys=[str(an.clean(c)) for c in col_keys], measure=measure,
                measure_label=an.MEASURES[measure][0])


# ------------------------------------------------------------------ organisations
@router.get("/orgs/search")
def org_search(q: str = Query(min_length=2), db: Session = Depends(get_db), v: Viewer = Depends(get_viewer)):
    st = get_settings(db)
    if not v.is_staff and (v.mode != "public" or not st["public_org_lookup"]):
        raise HTTPException(403, "ไม่เปิดให้ค้นหารายหน่วยงานในโหมดนี้")
    years = visible_years(db, v)
    df = cache.assessments_df(db)
    df = df[df["year"].isin(years)].drop_duplicates("org_code", keep="last")
    terms = q.strip().split()
    m = pd.Series(True, index=df.index)
    for t in terms:
        m &= (df["name"].str.contains(t, regex=False) | df["district"].fillna("").str.contains(t, regex=False)
              | df["province"].str.contains(t, regex=False) | (df["org_code"] == t))
    res = df[m].head(30)
    return [dict(code=r.org_code, name=r.name, district=r.district, province=r.province, org_type=r.org_type)
            for r in res.itertuples()]


@router.get("/orgs/{code}")
def org_detail(code: str, year: int | None = None, db: Session = Depends(get_db), v: Viewer = Depends(get_viewer)):
    st = get_settings(db)
    if not v.is_staff and (v.mode != "public" or not st["public_org_lookup"]):
        raise HTTPException(403, "ไม่เปิดให้ดูรายหน่วยงานในโหมดนี้")
    year = resolve_year(db, v, year)
    df = cache.assessments_df(db)
    ydf = df[df["year"] == year]
    row = ydf[ydf["org_code"] == code]
    org = db.get(Organization, code)
    if org is None:
        raise HTTPException(404, "ไม่พบหน่วยงาน")
    years = visible_years(db, v)
    hist = df[(df["org_code"] == code) & (df["year"].isin(years))].sort_values("year")
    base = dict(code=code, name=org.name, org_type=org.org_type, district=org.district,
                province=org.province.name_th if org.province else None,
                region=org.province.region if org.province else None, year=year, submitted=not row.empty,
                history=[dict(year=int(h.year), total=an.clean(h.total), grade=h.grade) for h in hist.itertuples()])
    if row.empty:
        return base
    r = row.iloc[0]
    same_prov = ydf[ydf["province"] == r["province"]]
    same_type = ydf[ydf["org_type"] == r["org_type"]]

    def cmp(g):
        return dict(n=len(g), total=an.clean(g["total"].mean()),
                    parts={p: an.clean(g[f"p{p}_pct"].mean()) for p in (1, 2, 3, 4)})

    base.update(
        total=an.clean(r["total"]), grade=r["grade"], q_pct=an.clean(r["q_pct"]), q40=an.clean(r["q40"]),
        lpa10=an.clean(r["lpa10"]), fin50=an.clean(r["fin50"]),
        parts={p: an.clean(r[f"p{p}_pct"]) for p in (1, 2, 3, 4)},
        percentile_national=an.clean((ydf["total"] < r["total"]).mean() * 100),
        percentile_province=an.clean((same_prov["total"] < r["total"]).mean() * 100),
        rank_province=int((same_prov["total"] > r["total"]).sum() + 1), n_province=len(same_prov),
        compare=dict(national=cmp(ydf), province=cmp(same_prov), org_type=cmp(same_type)))
    if v.is_staff:
        ans = (db.query(Answer, Question).join(Assessment, Assessment.id == Answer.assessment_id)
               .join(Question, (Question.year == Assessment.year) & (Question.q_no == Answer.q_no), isouter=True)
               .filter(Assessment.year == year, Assessment.org_code == code).order_by(Answer.q_no).all())
        allans = cache.answers_df(db, year)
        pass_rate = allans.groupby("q_no")["ratio"].apply(lambda s: (s.dropna() >= 0.999).mean() * 100)
        base.update(
            oag_code=org.oag_code, submitted_at=str(r["submitted_at"]) if pd.notna(r["submitted_at"]) else None,
            form_group=int(r["form_group"]),
            answers=[dict(q=a.q_no, key=a.item_key, part=q.part if q else None, short=q.short if q else "",
                          score=an.clean(a.score), max=a.max_score, text=a.answer_text,
                          national_pass=an.clean(pass_rate.get(a.q_no))) for a, q in ans])
    return base


