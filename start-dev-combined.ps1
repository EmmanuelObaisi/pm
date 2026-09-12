$ErrorActionPreference = "Stop"

function Get-FreePort {
    param(
        [int]$StartPort = 8000,
        [int]$EndPort = 8999
    )

    for ($port = $StartPort; $port -le $EndPort; $port++) {
        $inUse = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if (-not $inUse) {
            return $port
        }
    }

    throw "No free port available in range $StartPort-$EndPort"
}

$projectRoot = "C:\Users\shola\Projects\pm"
$backendRoot = Join-Path $projectRoot "backend"
$frontendRoot = Join-Path $projectRoot "frontend"
$pythonExe = "C:\Users\shola\AppData\Local\Programs\Python\Python314\python.exe"
$backendPort = Get-FreePort -StartPort 8000 -EndPort 8099
$frontendPort = Get-FreePort -StartPort 3000 -EndPort 3099

if (-not (Test-Path $pythonExe)) {
    throw "Python executable not found at $pythonExe"
}

if (-not (Test-Path $frontendRoot)) {
    throw "Frontend folder not found at $frontendRoot"
}

if (-not (Test-Path $backendRoot)) {
    throw "Backend folder not found at $backendRoot"
}

$lockPath = Join-Path $frontendRoot ".next\dev\lock"
if (Test-Path $lockPath) {
    Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
    Write-Host "Cleared stale Next.js lock: $lockPath"
}

Write-Host "Starting backend and frontend together in one terminal session..."
Write-Host "Backend port: $backendPort"
Write-Host "Frontend port: $frontendPort"

$backendJob = Start-Job -Name "pm-backend" -ScriptBlock {
    param($root, $python, $port)
    Set-Location $root
    & $python -m uvicorn app.main:app --reload --host 0.0.0.0 --port $port *>&1
} -ArgumentList $backendRoot, $pythonExe, $backendPort

$frontendJob = Start-Job -Name "pm-frontend" -ScriptBlock {
    param($root, $port)
    Set-Location $root
    Remove-Item "$root\.next\dev\lock" -Force -ErrorAction SilentlyContinue
    npm.cmd run dev -- --port $port *>&1
} -ArgumentList $frontendRoot, $frontendPort

try {
    while ($true) {
        $backendOutput = Receive-Job -Name "pm-backend" -Keep -ErrorAction SilentlyContinue
        foreach ($line in @($backendOutput)) {
            if ($line) { Write-Host "[backend] $line" }
        }

        $frontendOutput = Receive-Job -Name "pm-frontend" -Keep -ErrorAction SilentlyContinue
        foreach ($line in @($frontendOutput)) {
            if ($line) { Write-Host "[frontend] $line" }
        }

        if ($backendJob.State -ne "Running" -and $frontendJob.State -ne "Running") {
            break
        }

        Start-Sleep -Milliseconds 1000
    }
}
finally {
    if ($backendJob.State -eq "Running") { Stop-Job -Name "pm-backend" }
    if ($frontendJob.State -eq "Running") { Stop-Job -Name "pm-frontend" }
    Remove-Job -Name "pm-backend" -Force -ErrorAction SilentlyContinue
    Remove-Job -Name "pm-frontend" -Force -ErrorAction SilentlyContinue
}

Write-Host "Backend: http://localhost:$backendPort"
Write-Host "Frontend: http://localhost:$frontendPort"
Write-Host "Use user / password to sign in"
