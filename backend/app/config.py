import os
from pathlib import Path

import truststore
from dotenv import load_dotenv

# Verify TLS against the operating system's trust store instead of certifi's
# bundle. Antivirus and corporate proxies that inspect HTTPS re-sign traffic
# with a root they install in the OS store only, so certifi-based verification
# fails on OpenRouter with CERTIFICATE_VERIFY_FAILED. Verification stays on;
# this only changes where the trusted roots come from.
truststore.inject_into_ssl()

BASE_DIR = Path(__file__).resolve().parent
load_dotenv((BASE_DIR.parent.parent / ".env").resolve())

FRONTEND_DIST = (BASE_DIR / ".." / ".." / "frontend" / "out").resolve()

# The default keeps local development working; set JWT_SECRET for a real
# deployment. An empty value counts as unset, so passing the variable through
# docker compose when it is not in .env does not blank the secret.
JWT_SECRET = os.getenv("JWT_SECRET") or "development-secret-change-me-before-deploying"
JWT_ALGORITHM = "HS256"
TOKEN_TTL_HOURS = int(os.getenv("PM_TOKEN_TTL_HOURS", "168"))
PASSWORD_ROUNDS = int(os.getenv("PM_PASSWORD_ROUNDS", "200000"))

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL = "openai/gpt-oss-120b"
