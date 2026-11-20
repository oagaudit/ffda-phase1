"""ทดสอบเร็ว ๆ ว่า API ทำงานครบและแยกสิทธิ์ถูกต้อง (ต้องนำเข้าข้อมูลอย่างน้อย 1 ปีก่อน)

    python -m tests.test_smoke            # ทดสอบโหมด dev
    FFDA_MODE=public python -m tests.test_smoke
    FFDA_MODE=staff  python -m tests.test_smoke
"""
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

H_OVER = {"X-View-Mode": "overview"}
H_PUB = {"X-View-Mode": "public"}


def common(c):
    m = c.get("/api/meta", headers=H_OVER).json()
    assert m["years"], "ยังไม่มีปีที่เผยแพร่"
    s = c.get("/api/summary", headers=H_OVER).json()
    print("summary:", {k: s[k] for k in ("year", "n_submitted", "n_orgs", "submission_rate", "avg_total", "grades")})
    assert c.get("/api/breakdown?level=org", headers=H_OVER).status_code == 403
    assert c.get("/api/breakdown?level=tam", headers=H_PUB).status_code == 403
    assert c.get("/api/orgs/search?q=เมือง", headers=H_OVER).status_code == 403
    res = c.get("/api/orgs/search?q=ท่าตูม", headers=H_PUB).json()
    d = c.get(f"/api/orgs/{res[0]['code']}", headers=H_PUB).json()
    assert "answers" not in d and "oag_code" not in d
    cw = c.get("/api/questions/crosswalk", headers=H_OVER).json()
    assert all(y["status"] for y in cw["years"])
    a = c.get("/api/breakdown?level=amp&province=ชลบุรี", headers=H_PUB).json()
    print("public amp rows:", len(a["rows"]), a["rows"][0]["label"])
    return res[0]["code"]


def staff_checks(c, h):
    s = c.get("/api/summary?region=ภาคเหนือ", headers=h).json()
    print("staff north:", s["n_submitted"], s["avg_total"], "ยังไม่ส่ง", s["not_submitted"])
    t = c.get("/api/breakdown?level=tam&province=ชลบุรี", headers=h).json()
    print("tambon rows:", len(t["rows"]))
    o = c.get("/api/questions/1/options?province=ชลบุรี", headers=h).json()
    print("q1 options:", [(x["text"][:20], x["pct"], x["pct_national"]) for x in o["options"]][:3])
    mx = c.get("/api/questions/matrix?level=region&part=4", headers=h).json()
    print("matrix:", len(mx["rows"]), "rows ×", len(mx["questions"]), "questions")
    w = c.get("/api/watchlist?limit=5", headers=h).json()
    print("watchlist:", [(r["name"], r["total"], r["weakest"]) for r in w["rows"][:2]])
    assert c.get("/api/export.csv", headers=h).status_code == 200
    qs = c.get("/api/admin/questionnaires", headers=h).json()
    print("questionnaires:", [(q["year"], q["status"], q["n_questions"]) for q in qs])
    cw = c.get("/api/questions/crosswalk", headers=h).json()
    print("crosswalk:", len(cw["items"]), "items ·", [y["year"] for y in cw["years"]])
    tr = c.get("/api/questions/item-trend?key=ACC-09", headers=h).json()
    print("item-trend ACC-09:", [(r["year"], r.get("q"), r.get("avg_pct")) for r in tr["rows"]], "since", tr["comparable_since"])


def run():
    with TestClient(app) as c:
        print("mode:", settings.mode)
        code = common(c) if settings.mode != "staff" else None
        if settings.mode == "public":
            for path in ("/api/watchlist", "/api/admin/years", "/api/questions/1/options", "/api/export.csv",
                         "/api/admin/questionnaires", "/api/admin/settings"):
                r = c.get(path, headers={"X-View-Mode": "staff", "X-Remote-User": "OAG\\x"})
                assert r.status_code == 404, f"{path} ต้องไม่มีอยู่บนเครื่อง public ({r.status_code})"
            print("public: API เจ้าหน้าที่ไม่มีอยู่ ✓")
        elif settings.mode == "staff":
            assert c.get("/api/watchlist").status_code == 401, "ไม่มี SSO header ต้องเข้าไม่ได้"
            h = {settings.trusted_user_header: "OAG\\tester"}
            # TestClient มาจาก host 'testclient' — จำลองว่าเป็น IIS บนเครื่องเดียวกัน
            settings.trusted_proxies.append("testclient")
            staff_checks(c, h)
            print("me:", c.get("/api/auth/me", headers=h).json())
        else:
            h = {"X-View-Mode": "staff"}
            staff_checks(c, h)
            d = c.get(f"/api/orgs/{code}", headers=h).json()
            assert len(d["answers"]) == 43 and d["answers"][0]["key"]
        print("OK ✓")


def test_smoke():
    run()


if __name__ == "__main__":
    run()
