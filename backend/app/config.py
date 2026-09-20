import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv((BASE_DIR.parent.parent / ".env").resolve())

FRONTEND_DIST = (BASE_DIR / ".." / ".." / "frontend" / "out").resolve()

# The default keeps local development working; set JWT_SECRET for a real deployment.
JWT_SECRET = os.getenv("JWT_SECRET", "development-secret-change-me-before-deploying")
JWT_ALGORITHM = "HS256"
TOKEN_TTL_HOURS = int(os.getenv("PM_TOKEN_TTL_HOURS", "168"))
PASSWORD_ROUNDS = int(os.getenv("PM_PASSWORD_ROUNDS", "200000"))

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL = "openai/gpt-oss-120b"
