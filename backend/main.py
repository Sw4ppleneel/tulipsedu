import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.v1.router import router
from config import settings
from db.pool import close_pool, create_pool
from middleware.tenant import TenantMiddleware

logging.basicConfig(level=logging.DEBUG if settings.debug else logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = await create_pool(settings.database_url)
    logger.info("Database pool created")
    yield
    await close_pool(app.state.pool)
    logger.info("Database pool closed")


app = FastAPI(
    title="Tulips.edu API",
    version="0.1.0",
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
    lifespan=lifespan,
)

_cors_kwargs: dict = dict(
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
if settings.cors_origin_regex:
    _cors_kwargs["allow_origin_regex"] = settings.cors_origin_regex
else:
    _cors_kwargs["allow_origins"] = settings.cors_origins_list

app.add_middleware(CORSMiddleware, **_cors_kwargs)
app.add_middleware(TenantMiddleware)

app.include_router(router, prefix="/api/v1")


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s: %s", request.url.path, exc)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/health")
async def health():
    return {"status": "ok"}
