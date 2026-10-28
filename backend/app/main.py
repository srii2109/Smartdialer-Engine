"""FastAPI application entrypoint for SmartDialer."""

import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import init_db, seed_data
from app.api import router, engine, reconciler

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s"
)
logger = logging.getLogger("smartdialer")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup sequence
    logger.info("Initializing SmartDialer SQLite Database and Seeds...")
    init_db()
    seed_data(agent_count=50, borrower_count=300)

    # Start reconciler sweeper
    reconciler_task = asyncio.create_task(reconciler.run_loop(interval_sec=2.5))

    # Start dialer engine with 3 worker loops
    await engine.start(num_workers=3)

    yield

    # Shutdown sequence
    logger.info("Shutting down SmartDialer...")
    await engine.stop()
    reconciler.stop()
    reconciler_task.cancel()


app = FastAPI(
    title="SmartDialer Production Prototype",
    description="High-utilization, compliance-safe SmartDialer with Progressive & Predictive pacing, Safety Controller, and fault tolerance.",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.get("/")
def health_check():
    return {
        "status": "healthy",
        "service": "SmartDialer",
        "engine_active": engine.is_running
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
