from copy import deepcopy

from sqlalchemy.orm import Session

from ..models import AppSetting
from ..reference import DEFAULT_SETTINGS


def get_settings(db: Session) -> dict:
    out = deepcopy(DEFAULT_SETTINGS)
    for s in db.query(AppSetting).all():
        if not s.key.startswith("_"):      # คีย์ที่ขึ้นต้นด้วย _ เป็นสถานะภายในระบบ
            out[s.key] = s.value
    return out


def save_settings(db: Session, values: dict) -> dict:
    for k, v in values.items():
        if k not in DEFAULT_SETTINGS:
            continue
        row = db.get(AppSetting, k)
        if row:
            row.value = v
        else:
            db.add(AppSetting(key=k, value=v))
    db.commit()
    return get_settings(db)
