@echo off
setlocal

for /f "usebackq" %%P in (`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`) do (
  if not "%%P"=="" taskkill /PID %%P /F >nul 2>&1
)

Echo Stopped the app listening on port 8000.
