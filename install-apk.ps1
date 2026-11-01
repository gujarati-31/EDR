<#
.SYNOPSIS
    Compiles, provisions, and installs the latest Android Phone EDR Agent onto a connected device.

.PARAMETER SkipBuild
    Skip recompiling the APK with Gradle and use the existing build output.

.PARAMETER Clean
    Perform a clean Gradle build before assembling the APK.

.PARAMETER ServerHost
    The central EDR backend hostname or IP (defaults to phone-edr-central.onrender.com).
#>
param(
    [switch]$SkipBuild,
    [switch]$Clean,
    [string]$ServerHost = "phone-edr-central.onrender.com"
)

$ErrorActionPreference = "Continue"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "[+] Android EDR Agent Installer & Provisioner v2.0" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# 1. Locate ADB executable
$adbPath = "adb"
if (-not (Get-Command "adb" -ErrorAction SilentlyContinue)) {
    $sdkAdb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
    if (Test-Path $sdkAdb -ErrorAction SilentlyContinue) {
        $adbPath = $sdkAdb
    } elseif (Test-Path "C:\Android\platform-tools\adb.exe" -ErrorAction SilentlyContinue) {
        $adbPath = "C:\Android\platform-tools\adb.exe"
    } else {
        $adbPath = $sdkAdb
    }
}

# 2. Check for connected Android devices
Write-Host "`n[*] Verifying connected Android devices via ADB..." -ForegroundColor Yellow
$adbDevices = & $adbPath devices | Where-Object { $_ -and $_ -notmatch "List of devices" }
if (-not $adbDevices) {
    Write-Host "[!] No Android devices detected!" -ForegroundColor Red
    Write-Host "    Please ensure your phone is connected via USB and 'USB Debugging' is enabled." -ForegroundColor Yellow
    exit 1
}
Write-Host $adbDevices -ForegroundColor Green

$agentDir = Join-Path $PSScriptRoot "agent-android"
$apkPath = Join-Path $agentDir "app\build\outputs\apk\debug\app-debug.apk"

# 3. Always build fresh APK with Gradle unless -SkipBuild is passed
if (-not $SkipBuild) {
    Write-Host "`n[*] Building fresh EDR Agent APK using Gradle..." -ForegroundColor Yellow
    Push-Location $agentDir
    try {
        if ($Clean) {
            Write-Host "[*] Running clean..." -ForegroundColor Yellow
            & ".\gradlew.bat" clean
        }
        & ".\gradlew.bat" assembleDebug
        $buildStatus = $LASTEXITCODE
    } finally {
        Pop-Location
    }

    if ($buildStatus -ne 0 -or -not (Test-Path $apkPath)) {
        Write-Host "[!] Gradle build failed! Exit code: $buildStatus" -ForegroundColor Red
        exit 1
    }
    Write-Host "[+] Gradle build successful!" -ForegroundColor Green
} else {
    Write-Host "`n[*] -SkipBuild specified. Using existing APK binary." -ForegroundColor Yellow
}

if (-not (Test-Path $apkPath)) {
    Write-Host "[!] APK binary not found at $apkPath" -ForegroundColor Red
    exit 1
}

$apkItem = Get-Item $apkPath
Write-Host "[+] Target APK: $($apkItem.Name) ($([math]::Round($apkItem.Length / 1MB, 2)) MB)" -ForegroundColor Cyan
Write-Host "    Built At:   $($apkItem.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Cyan

# 4. Stop any existing running agent before upgrade
Write-Host "`n[*] Stopping running agent for clean update..." -ForegroundColor Yellow
& $adbPath shell am force-stop com.edr.agent 2>$null

# 5. Install APK to device (-r: reinstall, -d: allow downgrade if necessary)
Write-Host "`n[+] Installing EDR Agent APK to device..." -ForegroundColor Green
$installResult = & $adbPath install -r -d $apkPath 2>&1
$installText = $installResult -join "`n"
Write-Host $installText
if ($installText -notmatch "Success") {
    Write-Host "[!] APK install returned non-success. Attempting with --user 0..." -ForegroundColor Yellow
    & $adbPath install -r -d --user 0 $apkPath
}

# 6. Provision Device Administration / Device Owner
Write-Host "`n[+] Provisioning EDR as Device Admin & Owner..." -ForegroundColor Green
& $adbPath shell dpm set-active-admin com.edr.agent/.admin.EdrDeviceAdminReceiver 2>$null
& $adbPath shell dpm set-device-owner com.edr.agent/.admin.EdrDeviceAdminReceiver 2>$null

# 7. Grant comprehensive permissions (Camera, Logs, Media, Storage, Notifications)
Write-Host "`n[+] Granting EDR system permissions & AppOps..." -ForegroundColor Green
& $adbPath shell pm grant com.edr.agent android.permission.CAMERA 2>$null
& $adbPath shell pm grant com.edr.agent android.permission.READ_LOGS 2>$null
& $adbPath shell pm grant com.edr.agent android.permission.POST_NOTIFICATIONS 2>$null
& $adbPath shell pm grant com.edr.agent android.permission.READ_MEDIA_IMAGES 2>$null
& $adbPath shell pm grant com.edr.agent android.permission.READ_MEDIA_VIDEO 2>$null
& $adbPath shell pm grant com.edr.agent android.permission.READ_MEDIA_AUDIO 2>$null
& $adbPath shell pm grant com.edr.agent android.permission.READ_EXTERNAL_STORAGE 2>$null
& $adbPath shell pm grant com.edr.agent android.permission.WRITE_EXTERNAL_STORAGE 2>$null
& $adbPath shell pm grant com.edr.agent android.permission.RECORD_AUDIO 2>$null

# AppOps for background telemetry, usage tracking, and screen capture
& $adbPath shell appops set com.edr.agent GET_USAGE_STATS allow 2>$null
& $adbPath shell appops set com.edr.agent SYSTEM_ALERT_WINDOW allow 2>$null
& $adbPath shell appops set com.edr.agent MANAGE_EXTERNAL_STORAGE allow 2>$null
& $adbPath shell appops set com.edr.agent RECORD_AUDIO allow 2>$null
& $adbPath shell appops set com.edr.agent PROJECT_MEDIA allow 2>$null
& $adbPath shell appops set com.edr.agent ACCESS_RESTRICTED_SETTINGS allow 2>$null

# Whitelist from OS aggressive battery optimization
& $adbPath shell dumpsys deviceidle whitelist +com.edr.agent 2>$null

# 8. Enable Accessibility Service for silent traps and screen observation
Write-Host "`n[+] Enabling EDR Accessibility Service..." -ForegroundColor Green
$currentA11y = (& $adbPath shell settings get secure enabled_accessibility_services 2>$null)
if ($currentA11y -notmatch "com.edr.agent/.service.EdrAccessibilityService") {
    $targetA11y = if ($currentA11y -and $currentA11y -ne "null") {
        "$currentA11y:com.edr.agent/.service.EdrAccessibilityService"
    } else {
        "com.edr.agent/.service.EdrAccessibilityService"
    }
    & $adbPath shell settings put secure enabled_accessibility_services $targetA11y 2>$null
}
& $adbPath shell settings put secure accessibility_enabled 1 2>$null

# 9. Forward local USB port 3000 (allows reverse tunnel for local dev)
Write-Host "`n[+] Forwarding USB ADB Port 3000..." -ForegroundColor Green
& $adbPath reverse tcp:3000 tcp:3000 2>$null

# 10. Launch EDR Agent with Server Host parameter
Write-Host "`n[+] Launching EDR Agent connected to '$ServerHost'..." -ForegroundColor Green
& $adbPath shell am start -n com.edr.agent/.ui.MainActivity --es server_host "$ServerHost"

# 11. Trigger instant WebSocket reconnection
& $adbPath shell am broadcast -a com.edr.agent.ACTION_RECONNECT -n com.edr.agent/.receiver.EdrConnectReceiver 2>$null

Write-Host "`n==================================================" -ForegroundColor Cyan
Write-Host "[SUCCESS] Updated Agent Built, Installed & Provisioned!" -ForegroundColor Cyan
Write-Host "Target Server: $ServerHost" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
