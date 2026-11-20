"""API ฝั่งหลังบ้าน: เข้าสู่ระบบ, นำเข้า Excel, จัดการปี/เผยแพร่, ตั้งค่า, ผู้ใช้, มุมมองที่บันทึก"""
from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import Assessment, AssessmentYear, ImportBatch, SavedView, User
from ..security import Viewer, get_viewer, require_admin, require_staff
from ..services import cache
from ..services.importer import ImportError_, grade_of, import_excel
from ..services import questionnaire as qsvc
from ..services.public_sync import sync_to_public
from ..services.settings_store import get_settings, save_settings

router = APIRouter(prefix="/api", tags=["admin"])


# ------------------------------------------------------------------ ผู้ใช้ปัจจุบัน (จาก SSO)
@router.get("/auth/me")
def me(v: Viewer = Depends(get_viewer)):
    return dict(mode=v.mode, username=v.username, full_name=v.full_name, deploy_mode=settings.mode)


# ------------------------------------------------------------------ import Excel
@router.post("/admin/import")
async def upload_excel(year: int = Form(..., ge=2560, le=2700), dry_run: bool = Form(False),
                       file: UploadFile = File(...), db: Session = Depends(get_db),
                       v: Viewer = Depends(require_admin)):
    if not file.filename.lower().endswith((".xlsx", ".xlsm", ".xls")):
        raise HTTPException(400, "รองรับเฉพาะไฟล์ Excel (.xlsx)")
    folder = settings.upload_dir / str(year)
    folder.mkdir(parents=True, exist_ok=True)
    stored = folder / f"{datetime.now():%Y%m%d_%H%M%S}_{Path(file.filename).name}"
    with stored.open("wb") as fh:
        shutil.copyfileobj(file.file, fh)
    try:
        return import_excel(db, stored, year, file.filename, v.username, dry_run=dry_run)
    except ImportError_ as e:
        db.rollback()
        db.add(ImportBatch(year=year, filename=file.filename, stored_path=str(stored), status="failed",
                           warnings=[str(e)], created_by=v.username))
        db.commit()
        raise HTTPException(422, str(e))


@router.get("/admin/imports")
def list_imports(db: Session = Depends(get_db), v: Viewer = Depends(require_staff)):
    rows = db.query(ImportBatch).order_by(ImportBatch.created_at.desc()).limit(100).all()
    return [dict(id=b.id, year=b.year, filename=b.filename, status=b.status, total_rows=b.total_rows,
                 imported_rows=b.imported_rows, warnings=b.warnings, created_by=b.created_by,
                 created_at=b.created_at.isoformat(timespec="seconds")) for b in rows]


# ------------------------------------------------------------------ years / publish
@router.get("/admin/years")
def list_years(db: Session = Depends(get_db), v: Viewer = Depends(require_staff)):
    return [dict(year=y.year, label=y.label, status=y.status, n_records=y.n_records,
                 imported_at=y.imported_at.isoformat(timespec="seconds") if y.imported_at else None,
                 published_at=y.published_at.isoformat(timespec="seconds") if y.published_at else None)
            for y in db.query(AssessmentYear).order_by(AssessmentYear.year)]


@router.post("/admin/years/{year}/{action}")
def year_action(year: int, action: str, db: Session = Depends(get_db), v: Viewer = Depends(require_admin)):
    y = db.get(AssessmentYear, year)
    if not y:
        raise HTTPException(404, "ไม่พบปีนี้")
    if action == "publish":
        y.status, y.published_at = "published", datetime.now()
    elif action == "unpublish":
        y.status = "draft"
    else:
        raise HTTPException(400, "action ไม่ถูกต้อง")
    db.commit()
    cache.invalidate()
    return {"year": year, "status": y.status, "public_sync": _safe_sync(db)}


def _safe_sync(db: Session) -> dict:
    try:
        return sync_to_public(db)
    except Exception as e:  # เครื่อง public ติดต่อไม่ได้ -> แจ้งเตือน แต่ไม่ล้มการเผยแพร่
        return {"status": "failed", "message": f"ส่งข้อมูลไปเครื่อง public ไม่สำเร็จ: {e}"}


@router.post("/admin/sync-public")
def sync_public(db: Session = Depends(get_db), v: Viewer = Depends(require_admin)):
    return _safe_sync(db)


@router.delete("/admin/years/{year}")
def delete_year(year: int, db: Session = Depends(get_db), v: Viewer = Depends(require_admin)):
    y = db.get(AssessmentYear, year)
    if not y:
        raise HTTPException(404, "ไม่พบปีนี้")
    db.delete(y)
    db.query(Assessment).filter_by(year=year).delete()
    db.commit()
    cache.invalidate()
    return {"deleted": year}


# ------------------------------------------------------------------ settings
@router.get("/admin/settings")
def read_settings(db: Session = Depends(get_db), v: Viewer = Depends(require_staff)):
    return get_settings(db)


@router.put("/admin/settings")
def update_settings(values: dict = Body(...), db: Session = Depends(get_db), v: Viewer = Depends(require_admin)):
    st = save_settings(db, values)
    recompute_all(db)
    _safe_sync(db)
    return st


def recompute_all(db: Session):
    st = get_settings(db)
    for a in db.query(Assessment).all():
        a.grade = grade_of(a.total, st["grade_bands"])
    db.commit()
    cache.invalidate()


@router.post("/admin/recompute")
def recompute(db: Session = Depends(get_db), v: Viewer = Depends(require_admin)):
    recompute_all(db)
    return {"ok": True}


# ------------------------------------------------------------------ โครงสร้างแบบประเมินรายปี (เพิ่ม/ลด/แก้ข้อคำถาม)
def _qn_out(q, full=True):
    out = dict(year=q.year, status=q.status, base_year=q.base_year, diff=q.diff, note=q.note,
               created_by=q.created_by, updated_at=q.updated_at.isoformat(timespec="seconds") if q.updated_at else None,
               approved_by=q.approved_by, approved_at=q.approved_at.isoformat(timespec="seconds") if q.approved_at else None,
               n_questions=len(q.definition.get("questions", [])))
    if full:
        out["definition"] = q.definition
    return out


@router.get("/admin/questionnaires")
def list_questionnaires(db: Session = Depends(get_db), v: Viewer = Depends(require_staff)):
    years = {y.year: y for y in db.query(AssessmentYear)}
    out = []
    for q in db.query(qsvc.Questionnaire).order_by(qsvc.Questionnaire.year.desc()):
        d = _qn_out(q, full=False)
        d["has_data"] = bool(years.get(q.year) and years[q.year].n_records)
        out.append(d)
    return out


@router.get("/admin/questionnaires/{year}")
def get_questionnaire(year: int, db: Session = Depends(get_db), v: Viewer = Depends(require_staff)):
    q = qsvc.get(db, year)
    if not q:
        raise HTTPException(404, "ยังไม่มีโครงสร้างแบบประเมินปีนี้")
    return _qn_out(q)


@router.post("/admin/questionnaires/propose")
async def propose_questionnaire(year: int = Form(..., ge=2560, le=2700), file: UploadFile = File(...),
                                db: Session = Depends(get_db), v: Viewer = Depends(require_admin)):
    """อัปโหลดไฟล์ปีใหม่ → ระบบเทียบกับปีก่อนและเสนอโครงสร้าง (ยังไม่บันทึก)"""
    folder = settings.upload_dir / str(year)
    folder.mkdir(parents=True, exist_ok=True)
    stored = folder / f"{datetime.now():%Y%m%d_%H%M%S}_questionnaire_{Path(file.filename).name}"
    with stored.open("wb") as fh:
        shutil.copyfileobj(file.file, fh)
    keys = {k for q in db.query(qsvc.Questionnaire) for k in (x["key"] for x in q.definition["questions"])}
    try:
        return qsvc.propose(db, stored, year, keys)
    except qsvc.QuestionnaireError as e:
        raise HTTPException(422, str(e))


class QnIn(BaseModel):
    definition: dict
    base_year: int | None = None
    removed: list | None = None
    note: str | None = None


@router.put("/admin/questionnaires/{year}")
def save_questionnaire(year: int, body: QnIn, db: Session = Depends(get_db), v: Viewer = Depends(require_admin)):
    try:
        q = qsvc.save_draft(db, year, body.definition, body.base_year, body.removed, v.username, body.note)
    except qsvc.QuestionnaireError as e:
        raise HTTPException(422, str(e))
    return _qn_out(q)


@router.post("/admin/questionnaires/{year}/{action}")
def questionnaire_action(year: int, action: str, db: Session = Depends(get_db), v: Viewer = Depends(require_admin)):
    try:
        if action == "approve":
            q, warns = qsvc.approve(db, year, v.username)
            return dict(**_qn_out(q, full=False), warnings=warns)
        if action == "unapprove":
            y = db.get(AssessmentYear, year)
            if y and y.n_records:
                raise qsvc.QuestionnaireError(f"ปี {year} มีผลประเมินแล้ว {y.n_records:,} แห่ง — ลบข้อมูลปีนี้ก่อน หรือแก้แล้วนำเข้าใหม่")
            return _qn_out(qsvc.unapprove(db, year), full=False)
    except qsvc.QuestionnaireError as e:
        raise HTTPException(422, str(e))
    raise HTTPException(400, "action ไม่ถูกต้อง")


@router.delete("/admin/questionnaires/{year}")
def delete_questionnaire(year: int, db: Session = Depends(get_db), v: Viewer = Depends(require_admin)):
    q = qsvc.get(db, year)
    if not q:
        raise HTTPException(404)
    if q.status == "approved":
        raise HTTPException(422, "ลบได้เฉพาะฉบับร่าง")
    db.delete(q)
    db.commit()
    return {"deleted": year}


# ------------------------------------------------------------------ users (บัญชี AD — ไม่มีรหัสผ่านในระบบนี้)
class UserIn(BaseModel):
    username: str                 # บัญชี AD เช่น OAG\\somchai.k
    full_name: str | None = None
    role: str = "officer"


@router.get("/admin/users")
def list_users(db: Session = Depends(get_db), v: Viewer = Depends(require_admin)):
    return [dict(id=u.id, username=u.username, full_name=u.full_name, role=u.role, active=u.active,
                 env_admin=u.username.lower() in settings.admin_users)
            for u in db.query(User).order_by(User.id)]


@router.post("/admin/users")
def create_user(body: UserIn, db: Session = Depends(get_db), v: Viewer = Depends(require_admin)):
    if body.role not in ("admin", "officer"):
        raise HTTPException(400, "role ต้องเป็น admin หรือ officer")
    if db.query(User).filter(User.username.ilike(body.username.strip())).first():
        raise HTTPException(400, "มีบัญชีนี้แล้ว")
    u = User(username=body.username.strip(), full_name=body.full_name, role=body.role)
    db.add(u)
    db.commit()
    return {"id": u.id}


@router.patch("/admin/users/{uid}")
def update_user(uid: int, body: dict = Body(...), db: Session = Depends(get_db), v: Viewer = Depends(require_admin)):
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404)
    if "active" in body:
        u.active = bool(body["active"])
    if body.get("role") in ("admin", "officer"):
        u.role = body["role"]
    if "full_name" in body:
        u.full_name = body["full_name"]
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ saved views (view builder)
@router.get("/views")
def list_views(db: Session = Depends(get_db), v: Viewer = Depends(require_staff)):
    rows = db.query(SavedView).filter(or_(SavedView.owner == v.username, SavedView.shared.is_(True))) \
        .order_by(SavedView.created_at.desc()).all()
    return [dict(id=s.id, name=s.name, owner=s.owner, shared=s.shared, config=s.config,
                 mine=s.owner == v.username) for s in rows]


@router.post("/views")
def create_view(body: dict = Body(...), db: Session = Depends(get_db), v: Viewer = Depends(require_staff)):
    s = SavedView(name=body.get("name") or "มุมมองใหม่", owner=v.username, config=body.get("config") or {},
                  shared=bool(body.get("shared")))
    db.add(s)
    db.commit()
    return {"id": s.id}


@router.delete("/views/{vid}")
def delete_view(vid: int, db: Session = Depends(get_db), v: Viewer = Depends(require_staff)):
    s = db.get(SavedView, vid)
    if not s or (s.owner != v.username and not v.is_admin):
        raise HTTPException(404)
    db.delete(s)
    db.commit()
    return {"ok": True}
