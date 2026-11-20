# การติดตั้งใช้งานจริงบน Windows Server — แยกเว็บสาธารณะ / เว็บเจ้าหน้าที่ (ไม่มีหน้า login)

## หลักการ

| | เว็บสาธารณะ (FFDA-Public) | เว็บเจ้าหน้าที่ (FFDA-Staff) |
|---|---|---|
| ผู้ใช้ | ประชาชน / ผู้สนใจทั่วไป | เจ้าหน้าที่ สตง. |
| เครือข่าย | อินเทอร์เน็ต (HTTPS) | intranet เท่านั้น (จำกัด IP ภายใน) |
| ยืนยันตัวตน | ไม่ต้อง (Anonymous) | **SSO ด้วยบัญชี AD** ผ่าน IIS Windows Authentication — ไม่มีหน้า login |
| หน้าเว็บ | `frontend/dist-public` (`npm run build:public`) — มีแค่ภาพรวม/ประชาชน | `frontend/dist-staff` (`npm run build:staff`) |
| backend | service `FFDA-API-Public` พอร์ต 8001, `FFDA_MODE=public` — **ไม่มี API ของเจ้าหน้าที่อยู่ในโปรแกรมเลย** | service `FFDA-API-Staff` พอร์ต 8002, `FFDA_MODE=staff` |
| ข้อมูล | เฉพาะปีที่ "เผยแพร่" แล้ว ไม่มีคำตอบรายข้อ/ความเสี่ยง/ผู้ใช้ | ทั้งหมด รวมปีที่เป็นร่าง |
| สิทธิ์ผู้ดูแลระบบ | – | กลุ่ม AD (`AD_ADMIN_GROUP`) หรือ `ADMIN_USERS` ใน .env หรือกำหนดในหน้าตั้งค่า |

ความปลอดภัยไม่ได้พึ่ง IIS อย่างเดียว: ต่อให้ตั้ง IIS ผิด เว็บสาธารณะก็ไม่มีข้อมูลลับให้ดึง เพราะ backend โหมด public ไม่มี API เหล่านั้น และ (ถ้าแยกเครื่อง) ฐานข้อมูลฝั่ง public ไม่มีข้อมูลลับอยู่เลย

## รูปแบบที่ 1 — แยก 2 เครื่อง (แนะนำ เพราะเว็บประชาชนเปิดสู่อินเทอร์เน็ต)

```
[อินเทอร์เน็ต] ─HTTPS─► WAF/Firewall ─► เครื่อง PUBLIC (DMZ)
                                         IIS: FFDA-Public ─► FFDA-API-Public (8001) ─► PostgreSQL (public, มีแต่ข้อมูลเผยแพร่)
                                                                                          ▲ 5432 (เปิดให้เฉพาะ IP เครื่อง STAFF)
[intranet สตง.] ─HTTPS + SSO(AD)─► เครื่อง STAFF                                           │
                                         IIS: FFDA-Staff ─► FFDA-API-Staff (8002) ─► PostgreSQL (หลัก)
                                                                     └── กด "เผยแพร่" → ส่งข้อมูลที่เผยแพร่ได้ไปเครื่อง PUBLIC (ทางเดียว)
```

| | เครื่อง STAFF (intranet) | เครื่อง PUBLIC (DMZ) |
|---|---|---|
| OS | Windows Server 2022 Standard, **join โดเมน AD** | Windows Server 2022 Standard (ไม่ต้อง join โดเมน) |
| CPU / RAM | 8 vCPU / 16 GB | 4 vCPU / 8 GB |
| ดิสก์ | C: 100 GB + D: 200 GB SSD | C: 100 GB + D: 50 GB SSD |
| ซอฟต์แวร์ | IIS 10 + **Windows Authentication** + URL Rewrite + ARR, Python 3.12, PostgreSQL 16, NSSM | IIS 10 + URL Rewrite + ARR, Python 3.12, PostgreSQL 16, NSSM |
| เครือข่าย | ชื่อภายใน เช่น `ffda.oag.local` + SSL ภายใน, SPN สำหรับ Kerberos | ชื่อสาธารณะ เช่น `ffda.audit.go.th` + SSL สาธารณะ, อยู่หลัง WAF |
| Firewall | ออกไปเครื่อง PUBLIC พอร์ต 5432 ได้ | รับ 443 จากอินเทอร์เน็ต, รับ 5432 จากเครื่อง STAFF เท่านั้น, **ห้ามเชื่อมกลับเข้า intranet** |

ตั้งค่า `.env` เครื่อง STAFF: `PUBLIC_DATABASE_URL=postgresql+psycopg://ffda_sync:...@<IP เครื่อง PUBLIC>:5432/ffda_public`

## รูปแบบที่ 2 — เครื่องเดียว 2 เว็บไซต์ (กรณีงบจำกัด)

เครื่องเดียว join โดเมน, IIS 2 เว็บไซต์: FFDA-Staff ผูกกับ IP ภายใน, FFDA-Public ผูกกับ IP ที่ NAT ออกอินเทอร์เน็ต
ใช้ฐานข้อมูลเดียวกันได้ (เว้น `PUBLIC_DATABASE_URL` ว่าง) แต่แนะนำให้ service public ใช้บัญชีฐานข้อมูลแบบอ่านอย่างเดียว:
```sql
CREATE USER ffda_ro WITH PASSWORD '...';
GRANT CONNECT ON DATABASE ffda TO ffda_ro;
GRANT USAGE ON SCHEMA public TO ffda_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ffda_ro;
```
แล้วตั้ง `PUBLIC_RO_DATABASE_URL` ก่อนรัน install.ps1

## ขั้นตอนติดตั้ง

1. **Server Manager → Add Roles**: Web Server (IIS) + Security → **Windows Authentication**, **IP and Domain Restrictions** (เครื่อง staff)
   ติดตั้ง **URL Rewrite 2.1**, **Application Request Routing 3.0**, **Python 3.12 (64-bit)**, **PostgreSQL 16**, **NSSM**
2. **สร้างฐานข้อมูล** (`CREATE DATABASE ffda ...`) — เครื่อง public สร้าง `ffda_public` + ผู้ใช้ `ffda_sync` ที่เขียนได้
3. **Build หน้าเว็บบน Mac** แล้วคัดลอกไป: `npm run build:staff` → `dist-staff`, `npm run build:public` → `dist-public`
4. **คัดลอก** `backend/` และ `deploy/` ไปที่ `C:\ffda`
5. **รัน** `deploy\windows\install.ps1 -Role staff` (และ `-Role public` บนอีกเครื่อง หรือ `-Role both` ถ้าเครื่องเดียว)
   สคริปต์จะ: สร้าง venv, ลง service, ปลดล็อก Windows Authentication, อนุญาต server variable `HTTP_X_REMOTE_USER`, สร้างเว็บไซต์
6. **SSL**: เพิ่ม binding https:443 + ใบรับรองให้ทั้ง 2 เว็บไซต์
7. **SSO ไม่ถามรหัสผ่าน**: ให้ทีม AD เพิ่ม `https://ffda.oag.local` ใน Local Intranet zone ผ่าน Group Policy
   (Computer Config → Admin Templates → Windows Components → Internet Explorer → Security Page → Site to Zone Assignment List = 1)
   และตั้ง SPN ถ้าใช้ชื่อเว็บต่างจากชื่อเครื่อง: `setspn -S HTTP/ffda.oag.local <ชื่อเครื่อง>`
8. **สิทธิ์ผู้ดูแลระบบ** เลือกอย่างใดอย่างหนึ่ง:
   - ใส่บัญชีใน `.env`: `ADMIN_USERS=OAG\somchai.k,OAG\suda.p` หรือ
   - สร้างกลุ่ม AD `FFDA-Admins` แล้วตั้ง `AD_LDAP_URL`, `AD_BIND_USER`, `AD_BIND_PASSWORD`, `AD_BASE_DN`, `AD_ADMIN_GROUP` หรือ
   - ผู้ดูแลระบบกำหนดให้คนอื่นในหน้า **ตั้งค่า → สิทธิ์ผู้ใช้**
   ถ้าต้องการให้เฉพาะบางกลุ่มเข้าได้ ตั้ง `AD_USER_GROUP` (หรือเปิด `<authorization>` ใน staff/web.config)
9. **นำเข้าข้อมูลปี 2569** ในเว็บ staff → ตรวจทาน → กด **เผยแพร่** → ระบบส่งข้อมูลไปเว็บสาธารณะอัตโนมัติ
10. **สำรองข้อมูล**: Task Scheduler รัน `backup.ps1` ทุกวัน 02:00 (เครื่อง staff เป็นฐานข้อมูลหลัก)

## ตรวจสอบหลังติดตั้ง

- เปิดเว็บ staff จากเครื่องในโดเมน → เห็นชื่อผู้ใช้มุมขวาบนทันทีโดยไม่ต้อง login
- เปิดเว็บ staff จากนอก intranet → 403
- เปิด `https://ffda.audit.go.th/api/risk/top` → 404 (ไม่มี API นี้บนเว็บสาธารณะ)
- ปีที่ยังเป็น "ร่าง" ไม่ปรากฏบนเว็บสาธารณะ

## อัปเดตเวอร์ชัน (หลังแก้หน้าจอตามมติที่ประชุม)

```powershell
nssm stop FFDA-API-Staff; nssm stop FFDA-API-Public
# คัดลอก backend ใหม่ทับ (ยกเว้น .env, .venv, uploads) และ dist-staff / dist-public ใหม่ทับ (สคริปต์จะคัดลอก web.config ให้ใหม่)
cd C:\ffda\backend; .\.venv\Scripts\pip.exe install -r requirements.txt
nssm start FFDA-API-Staff; nssm start FFDA-API-Public
```

> หมายเหตุฐานข้อมูล: เวอร์ชันนี้เพิ่มคอลัมน์ใหม่ในตาราง (ตำบล/รหัสแผนที่) — ถ้าเคยติดตั้งเวอร์ชันก่อน ให้ล้างฐานข้อมูลแล้วนำเข้าใหม่
> (ข้อมูลมาจาก Excel ทั้งหมด จึงสร้างใหม่ได้เสมอ) ระยะยาวแนะนำเพิ่ม Alembic สำหรับ migration
