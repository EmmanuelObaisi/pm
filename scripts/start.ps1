$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
Set-Location "$rootDir\backend"

python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
