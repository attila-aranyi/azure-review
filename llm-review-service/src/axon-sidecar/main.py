"""
Axon Sidecar Service — HTTP API wrapping axon code intelligence.

Provides endpoints for indexing repos, querying impact/context/dead-code,
and managing repo graph lifecycle. Designed to run as a sidecar container
alongside the Node.js review service.
"""

import logging
import os

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

import graph_manager
import repo_manager

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Axon Sidecar",
    description="Code intelligence sidecar wrapping axon for the LLM review service",
    version="0.1.0",
)


# ---------- Request/Response Models ----------


class IndexRequest(BaseModel):
    clone_url: str = Field(..., description="ADO Git clone URL")
    access_token: str = Field(..., description="OAuth access token for cloning")
    branch: str = Field("main", description="Branch to index")


class ReindexRequest(BaseModel):
    access_token: str = Field(..., description="OAuth access token for fetching")
    branch: str = Field("main", description="Branch to update to")


class DetectChangesRequest(BaseModel):
    diff: str = Field(..., description="Raw git diff content")


class ImpactRequest(BaseModel):
    symbol: str = Field(..., description="Symbol name to analyze")
    depth: int = Field(3, ge=1, le=10, description="Traversal depth")


class ContextRequest(BaseModel):
    symbol: str = Field(..., description="Symbol name to get context for")


class IndexResponse(BaseModel):
    status: str
    symbols: int = 0
    edges: int = 0
    clusters: int = 0
    duration_ms: int = 0
    clone_duration_ms: int = 0
    analyze_duration_ms: int = 0
    error: str | None = None


class StatusResponse(BaseModel):
    indexed: bool
    graph_size_bytes: int = 0


# ---------- Health ----------


@app.on_event("startup")
async def startup():
    from graph_manager import EMBEDDINGS_ENABLED, EMBEDDING_MODEL_DIR
    if EMBEDDINGS_ENABLED:
        logger.info("Embeddings ENABLED (local model: %s)", EMBEDDING_MODEL_DIR)
    else:
        logger.info("Embeddings DISABLED (set AXON_EMBEDDING_MODEL_DIR to enable)")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "axon-sidecar"}


# ---------- Index / Reindex ----------


@app.post("/repos/{tenant_id}/{repo_id}/index", response_model=IndexResponse)
async def index_repo(tenant_id: str, repo_id: str, req: IndexRequest):
    """Clone repo and run axon analyze to build the knowledge graph."""
    logger.info("Indexing repo %s/%s from %s", tenant_id, repo_id, req.clone_url)

    # Step 1: Clone or update repo
    clone_result = repo_manager.clone_repo(
        tenant_id=tenant_id,
        repo_id=repo_id,
        clone_url=req.clone_url,
        access_token=req.access_token,
        branch=req.branch,
    )
    clone_duration_ms = clone_result["duration_ms"]

    # Step 2: Run axon analyze
    analyze_result = graph_manager.analyze(
        tenant_id=tenant_id,
        repo_id=repo_id,
        repo_path=clone_result["path"],
    )

    if analyze_result["status"] == "failed":
        return IndexResponse(
            status="failed",
            error=analyze_result.get("error", "Unknown error"),
            clone_duration_ms=clone_duration_ms,
            analyze_duration_ms=analyze_result.get("duration_ms", 0),
            duration_ms=clone_duration_ms + analyze_result.get("duration_ms", 0),
        )

    total_duration = clone_duration_ms + analyze_result["duration_ms"]

    return IndexResponse(
        status="ready",
        symbols=analyze_result.get("symbols", 0),
        edges=analyze_result.get("edges", 0),
        clusters=analyze_result.get("clusters", 0),
        clone_duration_ms=clone_duration_ms,
        analyze_duration_ms=analyze_result["duration_ms"],
        duration_ms=total_duration,
    )


@app.post("/repos/{tenant_id}/{repo_id}/reindex", response_model=IndexResponse)
async def reindex_repo(tenant_id: str, repo_id: str, req: ReindexRequest):
    """Fetch latest changes and re-analyze."""
    repo_path = repo_manager.get_clone_path(tenant_id, repo_id)
    if not repo_path:
        raise HTTPException(status_code=404, detail="Repo not indexed yet. Use /index first.")

    # Fetch updates
    clone_result = repo_manager.clone_repo(
        tenant_id=tenant_id,
        repo_id=repo_id,
        clone_url="",  # URL already set in clone
        access_token=req.access_token,
        branch=req.branch,
    )
    clone_duration_ms = clone_result["duration_ms"]

    # Re-analyze
    analyze_result = graph_manager.analyze(
        tenant_id=tenant_id,
        repo_id=repo_id,
        repo_path=repo_path,
    )

    total_duration = clone_duration_ms + analyze_result.get("duration_ms", 0)

    return IndexResponse(
        status=analyze_result.get("status", "failed"),
        symbols=analyze_result.get("symbols", 0),
        edges=analyze_result.get("edges", 0),
        clusters=analyze_result.get("clusters", 0),
        clone_duration_ms=clone_duration_ms,
        analyze_duration_ms=analyze_result.get("duration_ms", 0),
        duration_ms=total_duration,
        error=analyze_result.get("error"),
    )


# ---------- Query Endpoints ----------


@app.post("/repos/{tenant_id}/{repo_id}/detect-changes")
async def detect_changes(tenant_id: str, repo_id: str, req: DetectChangesRequest):
    """Detect which symbols were changed based on a git diff."""
    repo_path = repo_manager.get_clone_path(tenant_id, repo_id)
    if not repo_path:
        raise HTTPException(status_code=404, detail="Repo not indexed")

    return graph_manager.detect_changes(
        tenant_id=tenant_id,
        repo_id=repo_id,
        repo_path=repo_path,
        diff=req.diff,
    )


@app.post("/repos/{tenant_id}/{repo_id}/impact")
async def get_impact(tenant_id: str, repo_id: str, req: ImpactRequest):
    """Get impact/blast radius for a symbol."""
    repo_path = repo_manager.get_clone_path(tenant_id, repo_id)
    if not repo_path:
        raise HTTPException(status_code=404, detail="Repo not indexed")

    return graph_manager.get_impact(
        tenant_id=tenant_id,
        repo_id=repo_id,
        repo_path=repo_path,
        symbol=req.symbol,
        depth=req.depth,
    )


@app.post("/repos/{tenant_id}/{repo_id}/context")
async def get_context(tenant_id: str, repo_id: str, req: ContextRequest):
    """Get 360-degree context for a symbol (callers, callees, types, community)."""
    repo_path = repo_manager.get_clone_path(tenant_id, repo_id)
    if not repo_path:
        raise HTTPException(status_code=404, detail="Repo not indexed")

    return graph_manager.get_context(
        tenant_id=tenant_id,
        repo_id=repo_id,
        repo_path=repo_path,
        symbol=req.symbol,
    )


@app.post("/repos/{tenant_id}/{repo_id}/dead-code")
async def get_dead_code(tenant_id: str, repo_id: str):
    """Detect dead/unreachable code in the repository."""
    repo_path = repo_manager.get_clone_path(tenant_id, repo_id)
    if not repo_path:
        raise HTTPException(status_code=404, detail="Repo not indexed")

    return graph_manager.get_dead_code(
        tenant_id=tenant_id,
        repo_id=repo_id,
        repo_path=repo_path,
    )


# ---------- Graph Data ----------


@app.get("/repos/{tenant_id}/{repo_id}/graph-data")
async def get_graph_data(tenant_id: str, repo_id: str):
    """Return full graph with nodes, edges, and clusters for visualization."""
    repo_path = repo_manager.get_clone_path(tenant_id, repo_id)
    if not repo_path:
        raise HTTPException(status_code=404, detail="Repo not indexed")

    return graph_manager.get_graph_data(tenant_id, repo_id, repo_path)


# ---------- Status / Delete ----------


@app.get("/repos/{tenant_id}/{repo_id}/status", response_model=StatusResponse)
async def get_status(tenant_id: str, repo_id: str):
    """Get indexing status for a repository."""
    return graph_manager.get_status(tenant_id, repo_id)


@app.delete("/repos/{tenant_id}/{repo_id}")
async def delete_repo(tenant_id: str, repo_id: str):
    """Delete graph and cached clone for a repository."""
    graph_deleted = graph_manager.delete_graph(tenant_id, repo_id)
    clone_deleted = repo_manager.delete_clone(tenant_id, repo_id)

    if not graph_deleted and not clone_deleted:
        raise HTTPException(status_code=404, detail="Repo not found")

    return {
        "deleted": True,
        "graph_deleted": graph_deleted,
        "clone_deleted": clone_deleted,
    }
