$ErrorActionPreference = "Stop"

$processes = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
if (-not $processes) {
    Write-Host "No process is listening on port 8000."
    exit 0
}

foreach ($process in $processes) {
    $processId = $process.OwningProcess
    if ($processId) {
        Stop-Process -Id $processId -Force
    }
}

Write-Host "Stopped the app listening on port 8000."
