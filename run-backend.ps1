Write-Host "[+] Starting EDR Central Backend Server..." -ForegroundColor Cyan
Set-Location (Join-Path $PSScriptRoot "backend")
npm run dev
