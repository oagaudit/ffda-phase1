"""จัดการ "โครงสร้างแบบประเมิน" รายปี — รองรับการเพิ่ม/ลด/แก้ไขข้อคำถามในปีถัดไป

แนวคิดหลัก
---------
1) ทุกข้อมีรหัสตัวชี้วัดถาวร (item_key) เช่น REV-01 (ด้านรายได้ ตัวที่ 1) ไม่ผูกกับเลขข้อ
   ปีหน้าเลขข้อเลื่อนได้ แต่ item_key เดิม → เทียบแนวโน้มข้ามปีได้ถูกตัว
2) ทุกข้อของปีใหม่ถูกจัดประเภทเทียบปีฐาน
     same      = เหมือนเดิม                       → เทียบข้ามปีได้
     reworded  = ปรับถ้อยคำ/ปีงบประมาณ สาระเดิม     → เทียบข้ามปีได้
     changed   = เปลี่ยนสาระ/เกณฑ์ให้คะแนน          → ใช้รหัสเดิมแต่ "ตัดเส้นแนวโน้ม" (เทียบไม่ได้)
     new       = ข้อใหม่                          → รหัสใหม่
   ข้อในปีฐานที่ไม่ถูกจับคู่ = "ถูกยกเลิก" (removed)
3) ระบบ "เสนอ" การจับคู่อัตโนมัติจากความคล้ายของข้อความ → ผู้ดูแลตรวจ/แก้ → อนุมัติ → จึงนำเข้าผลได้
   (เครื่องช่วยคิด ไม่ใช่ผู้ตัดสิน — คนอนุมัติเสมอ)

คะแนนรวม/รายด้านคิดเป็น % ของคะแนนเต็มของปีนั้น จึงเทียบข้ามปีได้แม้จำนวนข้อเปลี่ยน
"""
from __future__ import annotations

import copy
import json
import re
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path

import pandas as pd
from sqlalchemy.orm import Session

from ..models import AssessmentYear, Questionnaire

MAPPING_DIR = Path(__file__).resolve().parent.parent / "mappings"
PART_PREFIX = {1: "REV", 2: "EXP", 3: "PRC", 4: "ACC"}
CHANGE_LABEL = {"same": "เหมือนเดิม", "reworded": "ปรับถ้อยคำ (เทียบได้)",
                "changed": "เปลี่ยนสาระ (เทียบไม่ได้)", "new": "ข้อใหม่", "removed": "ยกเลิก"}
SAME_AT, REWORD_AT, MATCH_AT = 0.95, 0.80, 0.55     # เกณฑ์ความคล้ายของข้อความ (ปรับได้)

_SCORE_COL = re.compile(r"^(?:g(?P<g>\d)_)?p(?P<p>\d+)_q(?P<q>\d+)(?P<avg>_average)?$")
_TEXT_COL = re.compile(r"^คำถาม(?:ที่)?\s*(?P<q>\d+)(?:\.(?P<sub>\d+))?\s+(?P<t>.+?)(?:\.\d+)?$")


class QuestionnaireError(Exception):
    pass


def _norm(s) -> str:
    return re.sub(r"\s+", " ", str(s).replace("\xa0", " ")).strip()


def norm_text(t: str | None) -> str:
    """ทำข้อความให้เทียบกันได้: ตัดปี พ.ศ. ตัวเลขปี ช่องว่าง เครื่องหมาย"""
    t = _norm(t or "")
    t = re.sub(r"(พ\.ศ\.?\s*)?25\d\d(\s*-\s*25\d\d)?", "#ปี", t)
    return re.sub(r"[\s\"'“”()\-–,.:;/]", "", t)


def similarity(a: str | None, b: str | None) -> float:
    a, b = norm_text(a), norm_text(b)
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b, autojunk=False).ratio()


# ------------------------------------------------------------------ อ่านนิยามแบบประเมิน
def file_definition(year: int | None = None) -> dict | None:
    for name in ([f"{year}.json"] if year else []):
        p = MAPPING_DIR / name
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    return None


def get(db: Session, year: int) -> Questionnaire | None:
    return db.get(Questionnaire, year)


def approved_definition(db: Session, year: int) -> dict:
    """นิยามที่ใช้นำเข้า: ต้องเป็นฉบับที่อนุมัติแล้วเท่านั้น"""
    q = db.get(Questionnaire, year)
    if q and q.status == "approved":
        return q.definition
    if q:
        raise QuestionnaireError(f"โครงสร้างแบบประเมินปี {year} ยังเป็น “ร่าง” — ให้ผู้ดูแลระบบตรวจและกดอนุมัติก่อนนำเข้า")
    raise QuestionnaireError(
        f"ยังไม่ได้กำหนดโครงสร้างแบบประเมินปี {year} — ไปที่เมนู “โครงสร้างแบบประเมิน” อัปโหลดไฟล์ปีนี้ "
        "ให้ระบบเทียบกับปีก่อน แล้วตรวจและอนุมัติ (ใช้เวลาไม่กี่นาที ถ้าข้อคำถามไม่เปลี่ยน)")


def seed_from_files(db: Session):
    """ปีที่มีไฟล์ mappings/<ปี>.json (เช่น 2569) ถือเป็นฉบับอนุมัติตั้งต้น"""
    for p in sorted(MAPPING_DIR.glob("25[0-9][0-9].json")):
        year = int(p.stem)
        if db.get(Questionnaire, year):
            continue
        d = json.loads(p.read_text(encoding="utf-8"))
        validate(d)
        db.add(Questionnaire(year=year, status="approved", definition=d, base_year=None,
                             diff=None, note=f"ฉบับตั้งต้นจากไฟล์ {p.name}", created_by="system",
                             approved_by="system", approved_at=datetime.now()))
    db.commit()


def validate(d: dict) -> list[str]:
    """ตรวจความถูกต้องของนิยาม — คืนรายการคำเตือน หรือ raise ถ้าใช้ไม่ได้"""
    errs, warns = [], []
    qs = d.get("questions") or []
    if not qs:
        errs.append("ไม่มีข้อคำถาม")
    keys = [q.get("key") for q in qs]
    if any(not k for k in keys):
        errs.append("มีข้อที่ยังไม่มีรหัสตัวชี้วัด (key)")
    dup = {k for k in keys if k and keys.count(k) > 1}
    if dup:
        errs.append("รหัสตัวชี้วัดซ้ำ: " + ", ".join(sorted(dup)))
    nos = [q.get("q") for q in qs]
    if len(set(nos)) != len(nos):
        errs.append("เลขข้อซ้ำ")
    for q in qs:
        if q.get("part") not in (1, 2, 3, 4):
            errs.append(f"ข้อ {q.get('q')}: ด้านต้องเป็น 1-4")
        for g in ("max_g1", "max_g2"):
            if not isinstance(q.get(g), (int, float)) or q[g] < 0:
                errs.append(f"ข้อ {q.get('q')}: คะแนนเต็ม {g} ไม่ถูกต้อง")
        if q.get("needs_review"):
            warns.append(f"ข้อ {q['q']}: {q['needs_review']}")
    for p in (1, 2, 3, 4):
        if not any(q.get("part") == p for q in qs):
            warns.append(f"ด้าน {p} ไม่มีข้อคำถาม")
    if errs:
        raise QuestionnaireError("; ".join(errs))
    return warns


# ------------------------------------------------------------------ ตรวจหาข้อคำถามจากไฟล์ Excel
def _find_header(path: Path, base: dict) -> tuple[pd.DataFrame, str]:
    xls = pd.ExcelFile(path)
    required = _norm(base["columns"]["org_code"])
    for sheet in dict.fromkeys(base.get("sheet_candidates", []) + xls.sheet_names):
        if sheet not in xls.sheet_names:
            continue
        head = pd.read_excel(xls, sheet_name=sheet, header=None, nrows=6, dtype=str)
        for r in range(len(head)):
            if required in [_norm(v) for v in head.iloc[r].tolist()]:
                df = pd.read_excel(xls, sheet_name=sheet, header=r, dtype=object)
                df.columns = [_norm(c) for c in df.columns]
                return df, sheet
    raise QuestionnaireError(f"ไม่พบชีตที่มีคอลัมน์ '{required}'")


def detect(df: pd.DataFrame, answers_after: str | None) -> dict[int, dict]:
    """หาข้อคำถามจากหัวคอลัมน์: คอลัมน์คะแนน (g1_p1_q1_average, p2_q11 …) + ข้อความคำถาม (คำถามที่ N …)"""
    found: dict[int, dict] = {}
    for c in df.columns:
        m = _SCORE_COL.match(c)
        if not m:
            continue
        qn, part, g = int(m["q"]), int(m["p"]), m["g"]
        x = found.setdefault(qn, dict(q=qn, part=part, col_g1=None, col_g2=None, text=None, text_g2=None))
        for grp in (("1", "2") if g is None else (g,)):
            k = f"col_g{grp}"
            # คอลัมน์ _average (ข้อที่มีรายการย่อย) ชนะคอลัมน์ธรรมดา
            if x[k] is None or m["avg"]:
                x[k] = c
    # ข้อความคำถามอยู่หลังคอลัมน์คะแนนรวม; ข้อ 1-8 มีสองชุด (ชุดแรก = อบต./เทศบาล, ชุดสอง = อบจ.)
    cols = list(df.columns)
    if answers_after and answers_after in cols:
        cols = cols[cols.index(answers_after) + 1:]
    grp, last = 1, 0
    for c in cols:
        m = _TEXT_COL.match(c)
        if not m or m["sub"]:
            continue
        qn = int(m["q"])
        if qn < last and grp == 1:
            grp = 2                        # เลขข้อย้อนกลับ = เริ่มชุดของ อบจ.
        last = qn
        if qn in found:
            k = "text" if grp == 1 or found[qn]["text"] is None else "text_g2"
            if not found[qn][k]:
                found[qn][k] = _norm(m["t"])
    for x in found.values():
        if x["text_g2"] == x["text"]:
            x["text_g2"] = None
    return dict(sorted(found.items()))


def _observed_max(df: pd.DataFrame, col: str | None) -> float | None:
    if not col or col not in df.columns:
        return None
    s = pd.to_numeric(df[col], errors="coerce").dropna()
    return float(s.max()) if len(s) else None


def _next_key(part: int, used: set[str]) -> str:
    pre = PART_PREFIX.get(part, f"P{part}")
    n = 1 + max([int(k.split("-")[1]) for k in used if k.startswith(pre + "-") and k.split("-")[1].isdigit()] or [0])
    return f"{pre}-{n:02d}"


def latest_approved_before(db: Session, year: int) -> Questionnaire | None:
    return (db.query(Questionnaire).filter(Questionnaire.year < year, Questionnaire.status == "approved")
            .order_by(Questionnaire.year.desc()).first())


def propose(db: Session, path: Path, year: int, all_keys: set[str] | None = None) -> dict:
    """เทียบไฟล์ปีใหม่กับแบบประเมินปีฐาน แล้วเสนอโครงสร้าง (ยังไม่บันทึก)"""
    base_q = latest_approved_before(db, year)
    if not base_q:
        raise QuestionnaireError(f"ไม่พบโครงสร้างแบบประเมินที่อนุมัติแล้วก่อนปี {year} สำหรับใช้เทียบ")
    base = base_q.definition
    df, sheet = _find_header(path, base)
    after = _norm(base.get("answers_after_column", ""))
    found = detect(df, after)
    if not found:
        raise QuestionnaireError("ไม่พบคอลัมน์คะแนนรายข้อ (รูปแบบ g1_p1_q1_average / p2_q11) ในไฟล์")

    # ---- จับคู่กับข้อในปีฐาน (ให้คะแนนจากข้อความเป็นหลัก + โบนัสเลขข้อ/ด้านเดิม) แบบ greedy
    base_qs = base["questions"]
    pairs = []
    for x in found.values():
        for b in base_qs:
            sim = similarity(x["text"], b.get("text"))
            if not x["text"] or not b.get("text"):         # ไม่มีข้อความ → ใช้ชื่อคอลัมน์
                sim = 0.9 if x["col_g1"] == b.get("col_g1") else 0.0
            bonus = 0.03 * (x["q"] == b["q"]) + 0.02 * (x["part"] == b["part"])
            pairs.append((sim + bonus, sim, x["q"], b["key"]))
    pairs.sort(reverse=True)
    match: dict[int, tuple[str, float]] = {}
    taken: set[str] = set()
    for score, sim, qn, key in pairs:
        if qn in match or key in taken or sim < MATCH_AT:
            continue
        match[qn] = (key, sim)
        taken.add(key)

    by_key = {b["key"]: b for b in base_qs}
    used = set(all_keys or set()) | set(by_key)
    questions = []
    for x in found.values():
        qd = {"q": x["q"], "part": x["part"], "col_g1": x["col_g1"] or x["col_g2"], "col_g2": x["col_g2"] or x["col_g1"],
              "text": x["text"], "text_g2": x["text_g2"]}
        obs1, obs2 = _observed_max(df, qd["col_g1"]), _observed_max(df, qd["col_g2"])
        if x["q"] in match:
            key, sim = match[x["q"]]
            b = by_key[key]
            change = "same" if sim >= SAME_AT else "reworded" if sim >= REWORD_AT else "changed"
            qd.update(key=key, change=change, similarity=round(sim, 3), base_q=b["q"], base_text=b.get("text"),
                      short=b["short"], short_g2=b.get("short_g2"), max_g1=b["max_g1"], max_g2=b["max_g2"])
            notes = []
            if change == "changed":
                notes.append("ข้อความต่างจากปีฐานมาก — ยืนยันว่าเป็นตัวชี้วัดเดิม (เปลี่ยนสาระ) หรือควรเป็นข้อใหม่")
            for g, obs in (("max_g1", obs1), ("max_g2", obs2)):
                if obs is not None and obs > qd[g] + 1e-9:
                    notes.append(f"คะแนนสูงสุดในไฟล์ ({obs:g}) เกินคะแนนเต็มเดิม ({qd[g]:g}) — ตรวจคะแนนเต็ม")
            if b["part"] != x["part"]:
                notes.append(f"ย้ายด้านจาก {b['part']} เป็น {x['part']}")
            if notes:
                qd["needs_review"] = " · ".join(notes)
        else:
            key = _next_key(x["part"], used)
            used.add(key)
            qd.update(key=key, change="new", similarity=None, base_q=None, base_text=None,
                      short=(x["text"] or f"ข้อ {x['q']}")[:60], max_g1=obs1 or 0, max_g2=obs2 or obs1 or 0,
                      needs_review="ข้อใหม่ — ตั้งชื่อย่อ และยืนยันคะแนนเต็ม (ระบบใช้คะแนนสูงสุดที่พบในไฟล์เป็นค่าเริ่มต้น)")
        questions.append(qd)

    removed = [dict(key=b["key"], q=b["q"], part=b["part"], short=b["short"]) for b in base_qs if b["key"] not in taken]
    # ---- ตรวจคอลัมน์ข้อมูลหลัก
    missing_cols = {k: v for k, v in base["columns"].items()
                    if _norm(v) not in df.columns and k not in ("oag_code", "submitted_at", "q40")}
    definition = copy.deepcopy({k: v for k, v in base.items() if k != "questions"})
    definition["questions"] = questions
    definition["_comment"] = f"โครงสร้างแบบประเมินปี {year} (เสนอจากการเทียบกับปี {base_q.year})"
    return dict(year=year, base_year=base_q.year, sheet=sheet, n_rows=len(df), definition=definition,
                headers=[c for c in df.columns][:400], missing_columns=missing_cols,
                diff=summarize(questions, removed), removed=removed)


def summarize(questions: list[dict], removed: list[dict]) -> dict:
    cnt = {k: 0 for k in ("same", "reworded", "changed", "new")}
    for q in questions:
        cnt[q.get("change") or "same"] = cnt.get(q.get("change") or "same", 0) + 1
    return dict(**cnt, removed=len(removed), removed_keys=[r["key"] for r in removed], n_questions=len(questions),
                needs_review=sum(1 for q in questions if q.get("needs_review")))


def save_draft(db: Session, year: int, definition: dict, base_year: int | None, removed: list | None,
               username: str | None, note: str | None = None) -> Questionnaire:
    validate(definition)
    q = db.get(Questionnaire, year)
    if q and q.status == "approved" and _has_data(db, year):
        raise QuestionnaireError(f"ปี {year} มีผลประเมินในระบบแล้ว — ยกเลิกอนุมัติก่อนแก้ไข แล้วนำเข้าผลใหม่หลังอนุมัติ")
    if removed is None and base_year:
        base = db.get(Questionnaire, base_year)
        keys = {x["key"] for x in definition["questions"]}
        removed = [dict(key=b["key"], q=b["q"], part=b["part"], short=b["short"])
                   for b in (base.definition["questions"] if base else []) if b["key"] not in keys]
    diff = summarize(definition["questions"], removed or [])
    diff["removed_items"] = removed or []
    if not q:
        q = Questionnaire(year=year)
        db.add(q)
    q.status, q.definition, q.base_year, q.diff, q.created_by = "draft", definition, base_year, diff, username
    q.note = note
    q.approved_by = q.approved_at = None
    db.commit()
    return q


def _has_data(db: Session, year: int) -> bool:
    y = db.get(AssessmentYear, year)
    return bool(y and y.n_records)


def approve(db: Session, year: int, username: str | None) -> tuple[Questionnaire, list[str]]:
    q = db.get(Questionnaire, year)
    if not q:
        raise QuestionnaireError("ไม่พบโครงสร้างแบบประเมินปีนี้")
    warns = validate(q.definition)
    q.status, q.approved_by, q.approved_at = "approved", username, datetime.now()
    for x in q.definition["questions"]:      # ผู้อนุมัติรับทราบประเด็นที่ต้องตรวจแล้ว
        x.pop("needs_review", None)
    q.definition = copy.deepcopy(q.definition)
    db.commit()
    return q, warns


def unapprove(db: Session, year: int) -> Questionnaire:
    q = db.get(Questionnaire, year)
    if not q:
        raise QuestionnaireError("ไม่พบโครงสร้างแบบประเมินปีนี้")
    q.status, q.approved_by, q.approved_at = "draft", None, None
    db.commit()
    return q


# ------------------------------------------------------------------ ตารางเทียบข้อคำถามข้ามปี (crosswalk)
def crosswalk(db: Session, years: list[int] | None = None) -> dict:
    rows = db.query(Questionnaire).order_by(Questionnaire.year).all()
    if years is not None:
        rows = [r for r in rows if r.year in years]
    items: dict[str, dict] = {}
    for qn in rows:
        for x in qn.definition["questions"]:
            it = items.setdefault(x["key"], dict(key=x["key"], part=x["part"], short=x["short"], years={}))
            it["short"], it["part"] = x["short"], x["part"]          # ใช้ชื่อย่อล่าสุด
            it["years"][qn.year] = dict(q=x["q"], change=x.get("change") or ("same" if qn.base_year else None),
                                        max_g1=x["max_g1"], max_g2=x["max_g2"])
    ys = [r.year for r in rows]
    for it in items.values():
        seen = [y for y in ys if y in it["years"]]
        for y in ys:
            if y not in it["years"] and seen and y > seen[0]:
                it["years"][y] = dict(q=None, change="removed")
    order = sorted(items.values(), key=lambda i: (i["part"], i["key"]))
    return dict(years=[dict(year=r.year, status=r.status, base_year=r.base_year, diff=r.diff) for r in rows],
                items=order, change_labels=CHANGE_LABEL)


def comparable_since(db: Session, key: str) -> int | None:
    """ปีแรกที่เทียบแนวโน้มได้ต่อเนื่องถึงปัจจุบัน (หลังการเปลี่ยนสาระครั้งล่าสุด)"""
    start = None
    for qn in db.query(Questionnaire).filter_by(status="approved").order_by(Questionnaire.year):
        x = next((q for q in qn.definition["questions"] if q["key"] == key), None)
        if x is None:
            start = None
        elif start is None or x.get("change") in ("changed", "new"):
            start = qn.year
    return start
