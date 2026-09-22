$ErrorActionPreference = "Stop"

$projectRoot = $PSScriptRoot
$backendRoot = Join-Path $projectRoot "backend"
$frontendRoot = Join-Path $projectRoot "frontend"

function Test-PortAvailable {
    param([int]$Port)

    if (Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue) {
        throw "Port $Port is already in use. Stop the existing server before starting development mode."
    }
}

foreach ($command in @("python", "npm.cmd")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Required command '$command' was not found on PATH."
    }
}

Test-PortAvailable 8000
Test-PortAvailable 3000

Write-Host "Starting the backend at http://localhost:8000"
Write-Host "Starting the frontend at http://localhost:3000"
Write-Host "Press Ctrl+C to stop both servers."

$backendJob = Start-Job -Name "pm-backend" -ScriptBlock {
    param($directory)
    Set-Location $directory
    python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 *>&1
} -ArgumentList $backendRoot

$frontendJob = Start-Job -Name "pm-frontend" -ScriptBlock {
    param($directory)
    Set-Location $directory
    npm.cmd run dev -- --port 3000 *>&1
} -ArgumentList $frontendRoot

try {
    while ($true) {
        foreach ($job in @($backendJob, $frontendJob)) {
            Receive-Job -Job $job -ErrorAction SilentlyContinue | ForEach-Object {
                Write-Host "[$($job.Name)] $_"
            }
        }

        if ($backendJob.State -ne "Running" -or $frontendJob.State -ne "Running") {
            throw "A development server stopped unexpectedly."
        }

        Start-Sleep -Seconds 1
    }
}
finally {
    foreach ($job in @($backendJob, $frontendJob)) {
        if ($job.State -eq "Running") {
            Stop-Job -Job $job
        }
        Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    }
}
