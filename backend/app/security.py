"""การแยกสิทธิ์โดยไม่มีหน้า login

- เครื่อง public : ทุกคำขอเป็นผู้ใช้ทั่วไป (overview / public) เสมอ ไม่มีทางเป็น จนท. ได้
- เครื่อง staff  : IIS (Windows Authentication = SSO กับ AD) ยืนยันตัวตนก่อนถึงระบบ แล้วส่งชื่อผู้ใช้มาใน header
                   ระบบเชื่อ header นี้เฉพาะเมื่อคำขอมาจาก IIS บนเครื่องเดียวกัน (TRUSTED_PROXIES)
                   สิทธิ์ admin มาจาก: กลุ่ม AD (ถ้าตั้ง LDAP) หรือ ADMIN_USERS ใน .env หรือกำหนดในหน้าตั้งค่า
- เครื่อง dev    : เลือกโหมดได้จาก header X-View-Mode (overview/public/staff) ผู้ใช้จำลอง = DEV_USER
"""
from __future__ import annotations

import logging
import time

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import User

log = logging.getLogger("ffda.security")
_group_cache: dict[str, tuple[float, set[str]]] = {}


class Viewer:
    """mode = overview | public | officer | admin"""

    def __init__(self, mode: str, username: str | None = None, full_name: str | None = None):
        self.mode = mode
        self.username = username
        self.full_name = full_name

    @property
    def is_staff(self) -> bool:
        return self.mode in ("officer", "admin")

    @property
    def is_admin(self) -> bool:
        return self.mode == "admin"


def _ad_groups(username: str) -> set[str]:
    """อ่านกลุ่มของผู้ใช้จาก AD (แคช 10 นาที) — ใช้เมื่อกำหนด AD_LDAP_URL เท่านั้น"""
    if not settings.ad_ldap_url:
        return set()
    hit = _group_cache.get(username)
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    groups: set[str] = set()
    try:
        from ldap3 import ALL, NTLM, Connection, Server  # ติดตั้งเพิ่ม: pip install ldap3
        sam = username.split("\\")[-1].split("@")[0]
        conn = Connection(Server(settings.ad_ldap_url, get_info=ALL), user=settings.ad_bind_user,
                          password=settings.ad_bind_password, authentication=NTLM, auto_bind=True)
        # LDAP_MATCHING_RULE_IN_CHAIN = รวมกลุ่มซ้อนกลุ่ม
        for g in filter(None, [settings.ad_admin_group, settings.ad_user_group]):
            conn.search(settings.ad_base_dn, f"(&(sAMAccountName={sam})(memberOf:1.2.840.113556.1.4.1941:={g}))",
                        attributes=["sAMAccountName"])
            if conn.entries:
                groups.add(g.lower())
        conn.unbind()
    except Exception as e:  # AD ล่ม -> ไม่ให้สิทธิ์ admin แต่ยังใช้งานแบบ officer ได้
        log.warning("AD lookup failed for %s: %s", username, e)
    _group_cache[username] = (time.time(), groups)
    return groups


def _staff_viewer(db: Session, username: str) -> Viewer:
    uname = username.strip()
    key = uname.lower()
    user = db.query(User).filter(User.username.ilike(uname)).first()
    if user and not user.active:
        raise HTTPException(403, "บัญชีนี้ถูกระงับการใช้งานระบบ FFDA")
    groups = _ad_groups(uname)
    if settings.ad_user_group and settings.ad_user_group.lower() not in groups and not (user and user.role == "admin"):
        raise HTTPException(403, "บัญชีนี้ไม่อยู่ในกลุ่มผู้มีสิทธิ์ใช้งานระบบ FFDA")
    is_admin = (key in settings.admin_users
                or (settings.ad_admin_group and settings.ad_admin_group.lower() in groups)
                or (user is not None and user.role == "admin"))
    if user is None:  # บันทึกผู้ใช้ที่เคยเข้าระบบ (ใช้ในหน้าจัดการสิทธิ์ และ audit)
        user = User(username=uname, role="officer", active=True)
        db.add(user)
        db.commit()
    return Viewer("admin" if is_admin else "officer", uname, user.full_name)


def get_viewer(request: Request, x_view_mode: str | None = Header(default=None),
               db: Session = Depends(get_db)) -> Viewer:
    if settings.mode == "public":
        return Viewer("public" if x_view_mode == "public" else "overview")

    if settings.mode == "staff":
        client = request.client.host if request.client else ""
        user = request.headers.get(settings.trusted_user_header)
        if not user or client not in settings.trusted_proxies:
            raise HTTPException(401, "ต้องเข้าใช้งานผ่านเครือข่ายภายใน สตง. (SSO) เท่านั้น")
        return _staff_viewer(db, user)

    # dev
    if x_view_mode == "staff":
        return Viewer("admin", settings.dev_user, "ผู้พัฒนา (จำลอง)")
    return Viewer("public" if x_view_mode == "public" else "overview")


def require_staff(viewer: Viewer = Depends(get_viewer)) -> Viewer:
    if not viewer.is_staff:
        raise HTTPException(403, "สำหรับเจ้าหน้าที่ สตง. เท่านั้น")
    return viewer


def require_admin(viewer: Viewer = Depends(get_viewer)) -> Viewer:
    if not viewer.is_admin:
        raise HTTPException(403, "สำหรับผู้ดูแลระบบเท่านั้น")
    return viewer
