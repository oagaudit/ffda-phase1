# สำรองฐานข้อมูล PostgreSQL ทุกวัน (ตั้งใน Task Scheduler: รันทุกวัน 02:00 ด้วยบัญชีที่มีสิทธิ์)
# เก็บไฟล์ย้อนหลัง 30 วัน
$Dest = "D:\ffda-backup"
$PgBin = "C:\Program Files\PostgreSQL\16\bin"
$env:PGPASSWORD = "<รหัสผ่านผู้ใช้ ffda>"
New-Item -ItemType Directory -Force $Dest | Out-Null
$file = Join-Path $Dest ("ffda_{0:yyyyMMdd_HHmm}.dump" -f (Get-Date))
& "$PgBin\pg_dump.exe" -h localhost -U ffda -F c -f $file ffda
Get-ChildItem $Dest -Filter "ffda_*.dump" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item
# กู้คืน: pg_restore -h localhost -U ffda -d ffda --clean <ไฟล์.dump>
