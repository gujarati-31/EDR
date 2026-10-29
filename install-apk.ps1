# Auto-detect ADB and install/provision the EDR Agent APK
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "[+] Android EDR Agent Installer & Provisioner" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# Locate ADB
$adbPath = "adb"
if (-not (Get-Command "adb" -ErrorAction SilentlyContinue)) {
    $sdkAdb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
    if (Test-Path $sdkAdb -ErrorAction SilentlyContinue) {
        $adbPath = $sdkAdb
    } elseif (Test-Path "C:\Android\platform-tools\adb.exe" -ErrorAction SilentlyContinue) {
        $adbPath = "C:\Android\platform-tools\adb.exe"
    } else {
        $adbPath = $sdkAdb # Attempt direct invocation
    }
}

Write-Host "`n[*] Checking connected devices via ADB..." -ForegroundColor Yellow
& $adbPath devices

$apkPath = Join-Path $PSScriptRoot "agent-android\app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $apkPath)) {
    Write-Host "[*] APK not found. Building APK with Gradle..." -ForegroundColor Yellow
    Push-Location (Join-Path $PSScriptRoot "agent-android")
    & ".\gradlew.bat" assembleDebug
    Pop-Location
}

Write-Host "`n[+] Installing EDR Agent APK to device..." -ForegroundColor Green
& $adbPath install -r $apkPath

Write-Host "`n[+] Provisioning EDR as Device Admin..." -ForegroundColor Green
& $adbPath shell dpm set-active-admin com.edr.agent/.admin.EdrDeviceAdminReceiver
& $adbPath shell dpm set-device-owner com.edr.agent/.admin.EdrDeviceAdminReceiver 2>$null

Write-Host "`n[+] Granting EDR permissions (Camera, Logs, /EDR Storage, Usage Stats)..." -ForegroundColor Green
& $adbPath shell pm grant com.edr.agent android.permission.CAMERA 2>$null
& $adbPath shell pm grant com.edr.agent android.permission.READ_LOGS 2>$null
& $adbPath shell pm grant com.edr.agent android.permission.POST_NOTIFICATIONS 2>$null
& $adbPath shell appops set com.edr.agent GET_USAGE_STATS allow 2>$null
& $adbPath shell appops set com.edr.agent SYSTEM_ALERT_WINDOW allow 2>$null
& $adbPath shell appops set com.edr.agent MANAGE_EXTERNAL_STORAGE allow 2>$null
& $adbPath shell pm grant com.edr.agent android.permission.RECORD_AUDIO 2>$null
& $adbPath shell appops set com.edr.agent RECORD_AUDIO allow 2>$null
& $adbPath shell appops set com.edr.agent PROJECT_MEDIA allow 2>$null

Write-Host "`n[+] Enabling EDR Silent Screen Capture & Accessibility Service..." -ForegroundColor Green
& $adbPath shell settings put secure enabled_accessibility_services com.edr.agent/.service.EdrAccessibilityService 2>$null
& $adbPath shell settings put secure accessibility_enabled 1 2>$null

Write-Host "`n[+] Forwarding Backend Port 3000 over USB..." -ForegroundColor Green
& $adbPath reverse tcp:3000 tcp:3000

Write-Host "`n[+] Launching EDR Agent..." -ForegroundColor Green
& $adbPath shell am start -n com.edr.agent/.ui.MainActivity

Write-Host "`n==================================================" -ForegroundColor Cyan
Write-Host "[SUCCESS] Installation & Device Owner Provisioning Complete!" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
