$ErrorActionPreference = "Stop"

$processIds = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
if (-not $processIds) {
    Write-Host "No process is listening on port 8000."
    exit 0
}

Stop-Process -Id $processIds -Force
Write-Host "Stopped the app listening on port 8000."
