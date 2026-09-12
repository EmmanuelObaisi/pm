@echo off
setlocal

set ROOT_DIR=%~dp0..
cd /d "%ROOT_DIR%\backend"

python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
