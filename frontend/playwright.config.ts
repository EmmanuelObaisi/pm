import { existsSync } from "node:fs";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright starts servers in a bare shell that has not activated the
 * project's virtualenv, so point at its interpreter directly when there is
 * one and fall back to whatever "python" resolves to otherwise.
 */
const pythonBin = (() => {
  for (const candidate of ["../.venv/Scripts/python.exe", "../.venv/bin/python"]) {
    if (existsSync(path.resolve(__dirname, candidate))) {
      return path.resolve(__dirname, candidate);
    }
  }
  return "python";
})();

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      // A throwaway database so the e2e run never touches the real one.
      command: `"${pythonBin}" -m uvicorn app.main:app --host 127.0.0.1 --port 8000`,
      cwd: "../backend",
      env: { PM_DB_PATH: "e2e.db" },
      url: "http://127.0.0.1:8000/health",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "npm run dev -- --hostname 127.0.0.1 --port 3000",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
