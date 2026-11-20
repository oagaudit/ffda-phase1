import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _list(name: str, default: str = "") -> list[str]:
    return [x.strip() for x in os.getenv(name, default).split(",") if x.strip()]


class Settings:
    # โหมดการติดตั้ง
    #   staff  = เครื่อง intranet สำหรับ จนท. สตง. (ยืนยันตัวตนด้วย SSO/AD ผ่าน IIS — ไม่มีหน้า login)
    #   public = เครื่องที่เปิดสู่อินเทอร์เน็ต (เฉพาะโหมดภาพรวม/ประชาชน — ไม่มี API ของ จนท. อยู่เลย)
    #   dev    = เครื่องนักพัฒนา (สลับได้ทุกโหมด ผู้ใช้จำลองจาก DEV_USER)
    mode: str = os.getenv("FFDA_MODE", "dev").lower()

    database_url: str = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'ffda.db'}")
    # ฐานข้อมูลของเครื่อง public (ถ้าตั้งไว้ เครื่อง staff จะส่งเฉพาะข้อมูลที่เผยแพร่แล้วไปให้อัตโนมัติ)
    public_database_url: str | None = os.getenv("PUBLIC_DATABASE_URL") or None

    # ---- SSO (Windows Authentication / AD) ผ่าน IIS
    # IIS ยืนยันตัวตนแล้วส่งชื่อผู้ใช้มาใน header นี้ (ตั้งค่า URL Rewrite: HTTP_X_REMOTE_USER = {LOGON_USER})
    trusted_user_header: str = os.getenv("TRUSTED_USER_HEADER", "X-Remote-User")
    # รับ header ข้างบนเฉพาะคำขอที่มาจาก IIS บนเครื่องเดียวกันเท่านั้น
    trusted_proxies: list[str] = _list("TRUSTED_PROXIES", "127.0.0.1,::1")
    # ผู้ดูแลระบบ (นำเข้า/เผยแพร่/ตั้งค่า): ระบุบัญชี AD ตรง ๆ  เช่น OAG\\somchai.k
    admin_users: list[str] = [u.lower() for u in _list("ADMIN_USERS")]
    # (ทางเลือก) ตรวจกลุ่มใน AD ผ่าน LDAP — ถ้าตั้งค่า ระบบจะถือว่าสมาชิกกลุ่มนี้เป็นผู้ดูแลระบบ
    ad_ldap_url: str | None = os.getenv("AD_LDAP_URL") or None              # ldaps://dc01.oag.local
    ad_bind_user: str | None = os.getenv("AD_BIND_USER") or None            # บัญชีบริการสำหรับอ่าน AD
    ad_bind_password: str | None = os.getenv("AD_BIND_PASSWORD") or None
    ad_base_dn: str | None = os.getenv("AD_BASE_DN") or None                # DC=oag,DC=local
    ad_admin_group: str | None = os.getenv("AD_ADMIN_GROUP") or None        # CN=FFDA-Admins,OU=Groups,DC=oag,DC=local
    ad_user_group: str | None = os.getenv("AD_USER_GROUP") or None          # (ถ้าตั้ง) เฉพาะสมาชิกกลุ่มนี้เข้าได้
    # ช่วงพัฒนาบน Mac: ผู้ใช้จำลอง
    dev_user: str = os.getenv("DEV_USER", "DEV\\developer")

    cors_origins: list[str] = _list("CORS_ORIGINS", "http://localhost:5173")
    upload_dir: Path = Path(os.getenv("UPLOAD_DIR", str(BASE_DIR / "uploads")))
    static_dir: Path = Path(os.getenv("STATIC_DIR", str(BASE_DIR.parent / "frontend" / "dist")))

    @property
    def is_public(self) -> bool:
        return self.mode == "public"


settings = Settings()
settings.upload_dir.mkdir(parents=True, exist_ok=True)
