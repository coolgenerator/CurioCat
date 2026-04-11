import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from curiocat.config import settings
from curiocat.db.session import engine

# Configure logging so pipeline INFO messages are visible
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    stream=sys.stderr,
)
# Quiet noisy libraries
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("openai").setLevel(logging.WARNING)
logging.getLogger("watchfiles").setLevel(logging.WARNING)
logging.getLogger("transformers").setLevel(logging.WARNING)
logging.getLogger("torch").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: preload NLI model in a background thread so it doesn't
    # block the event loop or the first evidence grounding request.
    import asyncio
    from curiocat.evidence.nli_scorer import preload_model
    asyncio.get_event_loop().run_in_executor(None, preload_model)

    yield
    # Shutdown: dispose of the engine connection pool
    await engine.dispose()


app = FastAPI(
    title="CurioCat",
    description="Causal Intelligence for Better Decisions",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {
        "name": "CurioCat",
        "description": "Causal Intelligence for Better Decisions",
        "version": "0.1.0",
    }


@app.get("/health")
async def health():
    return {"status": "ok"}


# API routers
from curiocat.api.routes import analysis, graph, scenarios, export, operations, causal_analysis, events  # noqa: E402

app.include_router(analysis.router)
app.include_router(graph.router)
app.include_router(scenarios.router)
app.include_router(export.router)
app.include_router(operations.router)
app.include_router(causal_analysis.router)
app.include_router(events.router)
