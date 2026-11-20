"""จุดเริ่มต้น API — รันด้วย:  uvicorn app.main:app --reload --port 8000"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import insert

from .config import settings
from .db import Base, SessionLocal, engine
from .models import Province, User
from .reference import PROVINCES
from .routers import admin, dashboard, staff
from .services.questionnaire import seed_from_files


def init_db():
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if db.query(Province).count() == 0:
            db.execute(insert(Province), [dict(code=c, name_th=t, name_en=e, region=r) for c, t, e, r in PROVINCES])
        # ผู้ดูแลระบบตั้งต้นจาก ADMIN_USERS (บัญชี AD) — ไม่มีรหัสผ่านในระบบนี้
        for name in settings.admin_users:
            if not db.query(User).filter(User.username.ilike(name)).first():
                db.add(User(username=name, role="admin"))
        db.commit()
        seed_from_files(db)     # โครงสร้างแบบประเมินปี 2569 (ฉบับตั้งต้น)


@asynccontextmanager
async def lifespan(_app):
    init_db()
    yield


app = FastAPI(title="FFDA — ระบบวิเคราะห์วินัยการเงินการคลัง อปท.", version="1.0.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(dashboard.router)
# เครื่อง public: ไม่ติดตั้ง API ของเจ้าหน้าที่ (ไม่ใช่แค่ซ่อน — ไม่มีอยู่เลย)
if not settings.is_public:
    app.include_router(staff.router)
    app.include_router(admin.router)
else:
    @app.get("/api/auth/me")
    def me_public():
        return {"mode": "public", "username": None, "deploy_mode": "public"}


@app.get("/api/health")
def health():
    return {"status": "ok", "mode": settings.mode}


# เสิร์ฟหน้าเว็บที่ build แล้ว (frontend/dist) จาก backend ตัวเดียวกัน — ใช้ตอน deploy แบบง่าย
if settings.static_dir.exists():
    app.mount("/assets", StaticFiles(directory=settings.static_dir / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(404, "Not Found")
        f = settings.static_dir / full_path
        if full_path and f.is_file():
            return FileResponse(f)
        return FileResponse(settings.static_dir / "index.html")
