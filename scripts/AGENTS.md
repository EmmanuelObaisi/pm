# Scripts

Start and stop the backend locally on port 8000, for Windows, Mac, and Linux.

- `start.ps1` / `start.sh` / `start.bat` — start uvicorn in the background and
  record the PID.
- `stop.ps1` / `stop.sh` / `stop.bat` — stop it.

These run the backend only. For the frontend as well, use
`npm run dev` in `frontend/` (its dev server proxies `/api` to port 8000), or
`start-dev-combined.ps1` in the repo root, which runs both.

The e2e suite starts its own servers and does not use these scripts.
