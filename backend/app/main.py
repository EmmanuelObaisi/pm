"""FastAPI application wiring."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import db, repository
from .config import FRONTEND_DIST
from .routers import ai, auth, boards, cards


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create the schema and seed the demo account a real server signs in with.

    This runs on startup and deliberately not at import time: importing this
    module must not touch, or migrate, a real database.
    """
    db.init_db()
    with db.connect() as connection:
        repository.ensure_demo_user(connection)
    yield


app = FastAPI(title="Project Management API", version="2.0.0", lifespan=lifespan)

app.include_router(auth.router)
app.include_router(auth.admin_router)
app.include_router(boards.router)
app.include_router(cards.router)
app.include_router(ai.router)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/hello", tags=["meta"])
def hello() -> dict[str, str]:
    return {"message": "hello world"}


if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
