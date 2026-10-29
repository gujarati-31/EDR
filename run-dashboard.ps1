Write-Host "[+] Starting EDR Web Management Dashboard..." -ForegroundColor Cyan
Set-Location (Join-Path $PSScriptRoot "management-dashboard")
npm run dev
