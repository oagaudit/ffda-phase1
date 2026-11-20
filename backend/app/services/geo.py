"""จับคู่ อปท. กับรหัสอำเภอ/ตำบลของแผนที่ (OpenGISData-Thailand, CC BY 4.0)

ลำดับการจับคู่ตำบล: 1) ชื่อตำบลจากทะเบียน อปท.  2) ชื่อ อปท. ตัดคำนำหน้า (เทศบาลตำบล/อบต. ฯลฯ) ตรงกับชื่อตำบลในอำเภอเดียวกัน
อปท. ที่จับคู่ตำบลไม่ได้ ยังแสดงในระดับอำเภอ; อบจ. แสดงที่ระดับจังหวัด
"""
from __future__ import annotations

import difflib
import json
import re
from functools import lru_cache
from pathlib import Path

PREFIXES = ["องค์การบริหารส่วนตำบล", "องค์การบริหารส่วนจังหวัด", "เทศบาลนคร", "เทศบาลเมือง", "เทศบาลตำบล",
            "อบต.", "อบจ.", "ทต.", "ทม.", "ทน."]


@lru_cache(maxsize=1)
def _lookup():
    g = json.loads((Path(__file__).resolve().parent.parent / "geo_lookup.json").read_text(encoding="utf-8"))
    amp_by_prov: dict[str, dict[str, str]] = {}
    amp_name: dict[str, str] = {}
    for code, name, pro in g["districts"]:
        amp_by_prov.setdefault(pro, {})[name] = code
        amp_name[code] = name
    tam_by_amp: dict[str, dict[str, str]] = {}
    tam_name: dict[str, str] = {}
    for code, name, amp in g["tambons"]:
        tam_by_amp.setdefault(amp, {})[name] = code
        tam_name[code] = name
    return amp_by_prov, tam_by_amp, amp_name, tam_name


def _clean_amp(s: str) -> str:
    return re.sub(r"^(อำเภอ|เขต|กิ่งอำเภอ)\s*", "", (s or "").strip())


def match_amp(pro_code: str | None, district: str | None) -> str | None:
    if not pro_code or not district:
        return None
    amps = _lookup()[0].get(pro_code, {})
    d = _clean_amp(district)
    if d in amps:
        return amps[d]
    # ชื่อในแผนที่บางอำเภอถูกตัดสั้น เช่น "เมืองประจวบคีรีข"
    for name, code in amps.items():
        if len(name) >= 4 and (d.startswith(name) or name.startswith(d)):
            return code
    close = difflib.get_close_matches(d, list(amps), n=1, cutoff=0.85)
    return amps[close[0]] if close else None


def match_tam(amp_code: str | None, subdistrict: str | None, org_name: str | None) -> str | None:
    if not amp_code:
        return None
    tams = _lookup()[1].get(amp_code, {})
    cands = []
    if subdistrict and str(subdistrict).strip().lower() not in ("", "nan", "null", "none"):
        cands.append(re.sub(r"^ตำบล\s*", "", str(subdistrict).strip()))
    if org_name:
        n = org_name.strip()
        for p in PREFIXES:
            if n.startswith(p):
                cands.append(n[len(p):].strip())
                break
    for c in cands:
        if c in tams:
            return tams[c]
    return None


def amp_name(code: str | None) -> str | None:
    return _lookup()[2].get(code) if code else None


def tam_name(code: str | None) -> str | None:
    return _lookup()[3].get(code) if code else None


def assign_geo(db) -> dict:
    """เติมรหัสอำเภอ/ตำบลให้ อปท. ทุกแห่ง (เรียกหลังนำเข้า)"""
    from ..models import Organization
    n_amp = n_tam = 0
    orgs = db.query(Organization).all()
    for o in orgs:
        o.amp_code = match_amp(o.province_code, o.district)
        o.tam_code = None if o.org_type in ("อบจ.", "รูปแบบพิเศษ") else match_tam(o.amp_code, o.subdistrict, o.name)
        n_amp += o.amp_code is not None
        n_tam += o.tam_code is not None
    db.flush()
    return {"orgs": len(orgs), "amp": n_amp, "tam": n_tam}
