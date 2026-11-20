# =============================================================================
#  ติดตั้ง FFDA บน Windows Server 2022  (Run as Administrator)
#
#  .\install.ps1 -Role both     # เครื่องเดียว 2 เว็บไซต์ (staff + public)
#  .\install.ps1 -Role staff    # เครื่อง intranet (แยกเครื่อง)
#  .\install.ps1 -Role public   # เครื่องที่เปิดสู่อินเทอร์เน็ต (แยกเครื่อง/DMZ)
#
#  ต้องติดตั้งไว้ก่อน: IIS + Windows Authentication feature + URL Rewrite 2.1 + ARR 3.0,
#                    Python 3.12 (64-bit), PostgreSQL 16, NSSM (nssm.exe ใน PATH)
#  โครงสร้างไฟล์: C:\ffda\backend, C:\ffda\frontend\dist-staff, C:\ffda\frontend\dist-public
# =============================================================================
param(
    [ValidateSet("both", "staff", "public")] [string]$Role = "both",
    [string]$Root = "C:\ffda",
    [string]$StaffHost = "ffda.oag.local",          # ชื่อเว็บภายใน
    [string]$PublicHost = "ffda.audit.go.th"        # ชื่อเว็บสาธารณะ
)
$ErrorActionPreference = "Stop"
Import-Module WebAdministration
$Backend = "$Root\backend"
$Py = "$Backend\.venv\Scripts\python.exe"
$AppCmd = "$env:windir\system32\inetsrv\appcmd.exe"

Write-Host "1) Python virtual environment + ไลบรารี" -ForegroundColor Cyan
Set-Location $Backend
if (-not (Test-Path $Py)) { py -3.12 -m venv .venv }
& $Py -m pip install --upgrade pip
& "$Backend\.venv\Scripts\pip.exe" install -r requirements.txt
if (-not (Test-Path "$Backend\.env")) {
    Copy-Item "$Backend\.env.example" "$Backend\.env"
    notepad "$Backend\.env"; Read-Host "แก้ .env เสร็จแล้วกด Enter (DATABASE_URL, ADMIN_USERS, PUBLIC_DATABASE_URL ...)"
}
New-Item -ItemType Directory -Force "$Root\logs" | Out-Null

function Install-ApiService($Name, $Port, $Mode, $ExtraEnv) {
    Write-Host "   - service $Name (FFDA_MODE=$Mode, port $Port)"
    if (Get-Service $Name -ErrorAction SilentlyContinue) { nssm stop $Name | Out-Null; nssm remove $Name confirm | Out-Null }
    nssm install $Name $Py "-m uvicorn app.main:app --host 127.0.0.1 --port $Port --workers 2 --proxy-headers --forwarded-allow-ips 127.0.0.1"
    nssm set $Name AppDirectory $Backend
    nssm set $Name AppEnvironmentExtra "FFDA_MODE=$Mode" @ExtraEnv
    nssm set $Name Start SERVICE_AUTO_START
    nssm set $Name AppStdout "$Root\logs\$Name.log"
    nssm set $Name AppStderr "$Root\logs\$Name-error.log"
    nssm set $Name AppRotateFiles 1
    nssm set $Name AppRotateBytes 10485760
    nssm start $Name
}

Write-Host "2) ลงทะเบียน backend เป็น Windows Service" -ForegroundColor Cyan
if ($Role -in "both", "staff") { Install-ApiService "FFDA-API-Staff" 8002 "staff" @() }
if ($Role -in "both", "public") {
    # เครื่อง public ใช้บัญชีฐานข้อมูลแบบอ่านอย่างเดียว (ตั้ง PUBLIC_RO_DATABASE_URL ในตัวแปรระบบก่อนรัน ถ้ามี)
    $extra = @(); if ($env:PUBLIC_RO_DATABASE_URL) { $extra = @("DATABASE_URL=$env:PUBLIC_RO_DATABASE_URL") }
    Install-ApiService "FFDA-API-Public" 8001 "public" $extra
}

Write-Host "3) ตั้งค่า IIS ระดับเซิร์ฟเวอร์ (ทำครั้งเดียว)" -ForegroundColor Cyan
& $AppCmd set config -section:system.webServer/proxy /enabled:"True" /commit:apphost
# อนุญาตให้ URL Rewrite เขียน header ชื่อผู้ใช้
& $AppCmd set config -section:system.webServer/rewrite/allowedServerVariables /+"[name='HTTP_X_REMOTE_USER']" /commit:apphost 2>$null
# ปลดล็อกให้ web.config ของเว็บไซต์ตั้งค่า authentication / ipSecurity ได้
& $AppCmd unlock config -section:system.webServer/security/authentication/windowsAuthentication
& $AppCmd unlock config -section:system.webServer/security/authentication/anonymousAuthentication
& $AppCmd unlock config -section:system.webServer/security/ipSecurity

function New-FfdaSite($Name, $Path, $HostName, $WebConfig) {
    Write-Host "   - เว็บไซต์ $Name → $Path ($HostName)"
    Copy-Item $WebConfig "$Path\web.config" -Force
    if (-not (Test-Path "IIS:\AppPools\$Name")) { New-WebAppPool $Name | Out-Null }
    Set-ItemProperty "IIS:\AppPools\$Name" managedRuntimeVersion ""
    if (Get-Website $Name) { Remove-Website $Name }
    New-Website -Name $Name -PhysicalPath $Path -ApplicationPool $Name -HostHeader $HostName -Port 80 | Out-Null
    Write-Warning "   เพิ่ม binding https:443 + ใบรับรอง SSL ให้ $Name ใน IIS Manager"
}

Write-Host "4) สร้างเว็บไซต์ใน IIS" -ForegroundColor Cyan
if ($Role -in "both", "staff")  { New-FfdaSite "FFDA-Staff"  "$Root\frontend\dist-staff"  $StaffHost  "$PSScriptRoot\staff\web.config" }
if ($Role -in "both", "public") { New-FfdaSite "FFDA-Public" "$Root\frontend\dist-public" $PublicHost "$PSScriptRoot\public\web.config" }

Write-Host "5) ทดสอบ" -ForegroundColor Cyan
Start-Sleep 5
if ($Role -in "both", "staff")  { Invoke-RestMethod http://127.0.0.1:8002/api/health }
if ($Role -in "both", "public") { Invoke-RestMethod http://127.0.0.1:8001/api/health }
Write-Host "เสร็จ — ทดสอบเปิด http://$StaffHost จากเครื่องในโดเมน (ต้องเห็นชื่อผู้ใช้มุมขวาบนโดยไม่ต้อง login)" -ForegroundColor Green
Write-Host "ถ้าเบราว์เซอร์ถามรหัสผ่าน: เพิ่ม $StaffHost ใน Local Intranet zone ผ่าน Group Policy (Site to Zone Assignment List = 1)" -ForegroundColor Yellow
