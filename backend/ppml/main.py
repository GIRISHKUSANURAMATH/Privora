"""FastAPI application factory and entry point."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path

import torch
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from ppml import __version__
from ppml.api import datasets, experiments
from ppml.api.deps import AppState
from ppml.config import PROJECT_ROOT, Settings, get_settings
from ppml.core.data.store import DatasetStore
from ppml.core.experiments.runner import ExperimentRunner
from ppml.core.ml.models import resolve_device
from ppml.db import Database
from ppml.logging_config import configure_logging
from ppml.security import BodySizeLimitMiddleware

log = logging.getLogger("ppml")
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"


def create_app(settings: Settings | None = None, serve_frontend: bool = True) -> FastAPI:
    settings = settings or get_settings()
    settings.ensure_dirs()
    configure_logging(settings.log_level)
    if settings.torch_threads:
        torch.set_num_threads(settings.torch_threads)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        db = Database(settings.db_path)
        store = DatasetStore(settings.datasets_dir, db)
        device = resolve_device(settings.device)
        runner = ExperimentRunner(db, store, settings.artifacts_dir, device, settings.max_concurrent_jobs)
        app.state.ppml = AppState(settings, db, store, runner, device)
        log.info("started", extra={"ctx": {"version": __version__, "device": str(device)}})
        yield
        runner.pool.shutdown(wait=False, cancel_futures=True)

    app = FastAPI(
        title="Umbra PPML API",
        version=__version__,
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    # Order matters: Starlette runs the last-added middleware first, so the host and body-size
    # guards below wrap everything else and reject requests before any parsing happens.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type"],
    )

    @app.middleware("http")
    async def security_headers(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        resp = await call_next(request)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        if not request.url.path.startswith("/api/docs"):
            resp.headers["Content-Security-Policy"] = (
                "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
                "font-src 'self' data:; script-src 'self'; connect-src 'self'; "
                "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
            )
        return resp

    # Reject requests whose Host header is not this machine: blocks DNS-rebinding attacks in which
    # a malicious web page resolves its own domain to 127.0.0.1 and reads the local API.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
    # Multipart overhead allowance on top of the file-size limit.
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_upload_bytes + 64 * 1024)

    @app.exception_handler(RequestValidationError)
    async def validation_handler(_r: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [{"loc": e.get("loc"), "msg": e.get("msg")} for e in exc.errors()]
        return JSONResponse({"detail": "Validation failed", "errors": errors}, status_code=422)

    @app.exception_handler(Exception)
    async def unhandled(_r: Request, exc: Exception) -> JSONResponse:
        log.error("unhandled error", extra={"ctx": {"type": type(exc).__name__}})
        return JSONResponse({"detail": "Internal server error"}, status_code=500)

    app.include_router(datasets.router)
    app.include_router(experiments.router)

    if serve_frontend and FRONTEND_DIST.exists():
        app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa(full_path: str) -> Response:
            if full_path.startswith("api/"):
                return JSONResponse({"detail": "Not found"}, status_code=404)
            candidate = (FRONTEND_DIST / full_path).resolve()
            if full_path and candidate.is_file() and FRONTEND_DIST.resolve() in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(Path(FRONTEND_DIST / "index.html"))

    return app


def run() -> None:
    import uvicorn

    s = get_settings()
    uvicorn.run(create_app(s), host=s.host, port=s.port, log_level=s.log_level.lower())


if __name__ == "__main__":
    run()
