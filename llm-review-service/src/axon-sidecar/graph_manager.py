"""
Manages axon graph lifecycle: analyze, query, and cleanup.

Wraps the axon CLI/API to provide indexing and querying capabilities
for the sidecar HTTP service.
"""

import json
import logging
import os
import subprocess
import time
from pathlib import Path

logger = logging.getLogger(__name__)

DATA_DIR = os.environ.get("DATA_DIR", "/data")
GRAPHS_DIR = os.path.join(DATA_DIR, "graphs")

# Timeout for axon operations (seconds)
ANALYZE_TIMEOUT = 300  # 5 minutes for large repos
QUERY_TIMEOUT = 60  # 1 minute for queries


class AxonError(Exception):
    """Raised when an axon operation fails."""

    def __init__(self, message: str, returncode: int = -1, stderr: str = ""):
        super().__init__(message)
        self.returncode = returncode
        self.stderr = stderr


def _graph_path(tenant_id: str, repo_id: str) -> str:
    """Return the graph storage path for a tenant/repo."""
    return os.path.join(GRAPHS_DIR, tenant_id, repo_id)


def _run_axon(
    args: list[str],
    cwd: str,
    timeout: int = QUERY_TIMEOUT,
    env_extra: dict | None = None,
) -> str:
    """Run an axon CLI command and return stdout.

    Args:
        args: Command arguments (e.g. ["analyze", "."])
        cwd: Working directory (repo clone path)
        timeout: Max execution time in seconds
        env_extra: Additional environment variables

    Returns:
        stdout as string

    Raises:
        AxonError: If the command fails or times out
    """
    cmd = ["axon"] + args
    env = os.environ.copy()
    if env_extra:
        env.update(env_extra)

    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )
    except subprocess.TimeoutExpired:
        raise AxonError(f"axon command timed out after {timeout}s: {' '.join(cmd)}")
    except FileNotFoundError:
        raise AxonError("axon CLI not found. Is axoniq installed?")

    if result.returncode != 0:
        raise AxonError(
            f"axon command failed: {' '.join(cmd)}",
            returncode=result.returncode,
            stderr=result.stderr,
        )

    return result.stdout


def analyze(
    tenant_id: str,
    repo_id: str,
    repo_path: str,
) -> dict:
    """Run axon analyze on a repository to build/update the knowledge graph.

    Returns:
        dict with keys: status, duration_ms, graph_path
        plus any stats axon reports (symbols, edges, clusters)
    """
    graph_path = _graph_path(tenant_id, repo_id)
    os.makedirs(graph_path, exist_ok=True)

    start = time.monotonic()

    try:
        # Run axon analyze from within the repo dir (axon stores graph in .axon/kuzu)
        output = _run_axon(
            ["analyze", "."],
            cwd=repo_path,
            timeout=ANALYZE_TIMEOUT,
        )
    except AxonError:
        # Retry with explicit path
        try:
            output = _run_axon(
                ["analyze", repo_path],
                cwd=repo_path,
                timeout=ANALYZE_TIMEOUT,
            )
        except AxonError as e:
            logger.error("axon analyze failed: %s (returncode=%d, stderr=%s)", e, e.returncode, e.stderr)
            return {
                "status": "failed",
                "error": f"{e} | stderr: {e.stderr}",
                "duration_ms": int((time.monotonic() - start) * 1000),
                "graph_path": graph_path,
            }

    duration_ms = int((time.monotonic() - start) * 1000)

    # Try to parse JSON output for stats
    stats = _parse_analyze_output(output)

    logger.info(
        "Analyzed repo %s/%s in %dms: %s",
        tenant_id, repo_id, duration_ms, stats,
    )

    return {
        "status": "ready",
        "duration_ms": duration_ms,
        "graph_path": graph_path,
        **stats,
    }


def _parse_analyze_output(output: str) -> dict:
    """Try to parse axon analyze output for statistics."""
    try:
        data = json.loads(output)
        return {
            "symbols": data.get("symbols", 0),
            "edges": data.get("edges", 0),
            "clusters": data.get("clusters", 0),
        }
    except (json.JSONDecodeError, TypeError):
        # Try to extract stats from text output
        stats: dict = {"symbols": 0, "edges": 0, "clusters": 0}
        for line in output.strip().split("\n"):
            line_lower = line.lower()
            if "symbol" in line_lower:
                try:
                    stats["symbols"] = int("".join(filter(str.isdigit, line)))
                except ValueError:
                    pass
            elif "edge" in line_lower:
                try:
                    stats["edges"] = int("".join(filter(str.isdigit, line)))
                except ValueError:
                    pass
            elif "cluster" in line_lower or "communit" in line_lower:
                try:
                    stats["clusters"] = int("".join(filter(str.isdigit, line)))
                except ValueError:
                    pass
        return stats


def detect_changes(
    tenant_id: str,
    repo_id: str,
    repo_path: str,
    diff: str,
) -> dict:
    """Detect which symbols were changed based on a git diff.

    Returns:
        dict with changed_symbols list
    """
    graph_path = _graph_path(tenant_id, repo_id)

    # Write diff to temp file for axon to read
    diff_path = os.path.join(graph_path, ".tmp_diff")
    try:
        os.makedirs(os.path.dirname(diff_path), exist_ok=True)
        with open(diff_path, "w") as f:
            f.write(diff)

        try:
            output = _run_axon(
                ["detect-changes", "--diff-file", diff_path, "--output-format", "json"],
                cwd=repo_path,
                env_extra={"AXON_GRAPH_DIR": graph_path},
            )
            data = json.loads(output)
            return {"changed_symbols": data.get("changed_symbols", [])}
        except (AxonError, json.JSONDecodeError) as e:
            logger.warning("detect-changes failed, falling back to empty: %s", e)
            return {"changed_symbols": []}
    finally:
        if os.path.exists(diff_path):
            os.remove(diff_path)


def get_impact(
    tenant_id: str,
    repo_id: str,
    repo_path: str,
    symbol: str,
    depth: int = 3,
) -> dict:
    """Get impact/blast radius analysis for a symbol.

    Returns:
        dict with blast_radius grouped by depth
    """
    graph_path = _graph_path(tenant_id, repo_id)

    try:
        output = _run_axon(
            ["impact", symbol, "--depth", str(depth), "--output-format", "json"],
            cwd=repo_path,
            env_extra={"AXON_GRAPH_DIR": graph_path},
        )
        data = json.loads(output)
        return {"blast_radius": data.get("blast_radius", data.get("impact", {}))}
    except (AxonError, json.JSONDecodeError) as e:
        logger.warning("impact query failed for %s: %s", symbol, e)
        return {"blast_radius": {}}


def get_context(
    tenant_id: str,
    repo_id: str,
    repo_path: str,
    symbol: str,
) -> dict:
    """Get 360-degree context for a symbol.

    Returns:
        dict with callers, callees, types, community info
    """
    graph_path = _graph_path(tenant_id, repo_id)

    try:
        output = _run_axon(
            ["context", symbol, "--output-format", "json"],
            cwd=repo_path,
            env_extra={"AXON_GRAPH_DIR": graph_path},
        )
        return json.loads(output)
    except (AxonError, json.JSONDecodeError) as e:
        logger.warning("context query failed for %s: %s", symbol, e)
        return {"callers": [], "callees": [], "types": [], "community": None}


# ── Pipeline cache ──
# Avoids running the expensive pipeline twice when both graph-data and dead-code
# are requested for the same repo.

_pipeline_cache: dict[str, tuple[float, object]] = {}  # repo_path -> (timestamp, KnowledgeGraph)
_CACHE_TTL = 300  # 5 minutes


def _get_cached_kg(repo_path: str) -> object | None:
    """Return a cached KnowledgeGraph, running the pipeline if needed."""
    from pathlib import Path as _Path
    from axon.core.ingestion.pipeline import run_pipeline

    now = time.monotonic()
    cached = _pipeline_cache.get(repo_path)
    if cached and (now - cached[0]) < _CACHE_TTL:
        return cached[1]

    try:
        kg, _result = run_pipeline(_Path(repo_path), storage=None, embeddings=False)
        _pipeline_cache[repo_path] = (now, kg)
        # Evict old entries (keep max 4)
        if len(_pipeline_cache) > 4:
            oldest = min(_pipeline_cache, key=lambda k: _pipeline_cache[k][0])
            del _pipeline_cache[oldest]
        logger.info("Pipeline cache: %d nodes, %d rels for %s", kg.node_count, kg.relationship_count, repo_path)
        return kg
    except Exception as e:
        logger.error("Pipeline run failed: %s", e, exc_info=True)
        return None


# ── Dead code classification ──

# Patterns that indicate framework entry points / test helpers
_ENTRY_PATTERNS = {
    "route", "handler", "middleware", "plugin", "hook",
    "controller", "resolver", "subscriber", "listener",
    "setup", "teardown", "beforeAll", "afterAll", "beforeEach", "afterEach",
}

_TEST_PATTERNS = {"test", "spec", "fixture", "mock", "stub", "fake", "helper"}


def _classify_dead_symbol(
    name: str,
    file: str,
    kind: str,
    is_exported: bool,
    is_entry_point: bool,
    kg: object,
    axon_id: str,
) -> tuple[str, str, bool]:
    """Classify a dead symbol into confidence/reason/safeToDelete.

    Returns:
        (confidence, reason, safe_to_delete)
    """
    file_lower = file.lower()
    name_lower = name.lower()

    # Entry points are likely not dead — framework may call them
    if is_entry_point:
        return ("low", "Marked as entry point — likely called by framework", False)

    # Test files: symbols here are invoked by test runners
    if any(p in file_lower for p in ("/test/", "/tests/", "/__tests__/", ".test.", ".spec.")):
        return ("low", "Located in test file — invoked by test runner", False)

    # Test helper patterns in the name
    if any(p in name_lower for p in _TEST_PATTERNS):
        return ("low", "Name suggests test helper — may be used by test infrastructure", False)

    # Exported symbols may be consumed externally
    if is_exported:
        # Exported from an index/barrel file — likely a public API
        if file_lower.endswith("index.ts") or file_lower.endswith("index.js"):
            return ("low", "Exported from barrel file — may be part of public API", False)
        return ("medium", "Exported but unreferenced within this repository", False)

    # Framework handler patterns
    if any(p in name_lower for p in _ENTRY_PATTERNS):
        return ("low", "Name suggests framework handler — may be called by runtime", False)

    # Truly internal and unreferenced — high confidence
    return ("high", "No callers found in codebase — internal and unreachable", True)


def get_dead_code(
    tenant_id: str,
    repo_id: str,
    repo_path: str,
) -> dict:
    """Detect dead/unreachable code in the repository.

    Runs the pipeline in-process, reads node.is_dead, and classifies
    each dead symbol with confidence and reason.

    Returns:
        dict with dead_symbols list (enriched with confidence/reason/safeToDelete)
    """
    kg = _get_cached_kg(repo_path)
    if kg is None:
        return {"dead_symbols": []}

    dead_symbols = []
    from axon.core.graph.graph import NodeLabel
    symbol_labels = {NodeLabel.FUNCTION, NodeLabel.CLASS, NodeLabel.METHOD,
                     NodeLabel.INTERFACE, NodeLabel.TYPE_ALIAS, NodeLabel.ENUM}

    for node in kg.iter_nodes():
        if not getattr(node, "is_dead", False):
            continue
        axon_id = getattr(node, "id", None) or str(node)
        kind = "unknown"
        for sl in symbol_labels:
            if axon_id.startswith(sl.value + ":"):
                kind = sl.value
                break
        if kind == "unknown":
            continue

        name = getattr(node, "class_name", None) or axon_id.rsplit(":", 1)[-1] or axon_id
        file = getattr(node, "file_path", "") or ""
        line = getattr(node, "start_line", None)
        is_exported = getattr(node, "is_exported", False)
        is_entry = getattr(node, "is_entry_point", False)

        confidence, reason, safe = _classify_dead_symbol(
            name=name, file=file, kind=kind,
            is_exported=is_exported, is_entry_point=is_entry,
            kg=kg, axon_id=axon_id,
        )

        dead_symbols.append({
            "file": file,
            "name": name,
            "type": kind,
            "confidence": confidence,
            "reason": reason,
            "safeToDelete": safe,
            "line": line,
        })

    # Sort: high confidence first, then medium, then low
    order = {"high": 0, "medium": 1, "low": 2}
    dead_symbols.sort(key=lambda s: (order.get(s["confidence"], 3), s["file"], s["name"]))

    logger.info("Dead code: %d total (%d high, %d medium, %d low)",
                len(dead_symbols),
                sum(1 for s in dead_symbols if s["confidence"] == "high"),
                sum(1 for s in dead_symbols if s["confidence"] == "medium"),
                sum(1 for s in dead_symbols if s["confidence"] == "low"))

    return {"dead_symbols": dead_symbols}


def get_graph_data(tenant_id: str, repo_id: str, repo_path: str) -> dict:
    """Return the full graph for visualization: nodes, edges, clusters.

    Uses the cached pipeline result to get the in-memory KnowledgeGraph
    with both nodes AND edges, plus dead code annotations.
    """
    from axon.core.graph.graph import NodeLabel

    nodes = []
    edges = []
    clusters: dict[int, int] = {}

    try:
        kg = _get_cached_kg(repo_path)
        if kg is None:
            return {"nodes": [], "edges": [], "clusters": []}

        logger.info("Graph data pipeline: %d nodes, %d rels",
                     kg.node_count, kg.relationship_count)

        # Build node ID lookup: axon_id -> viz_id
        id_map: dict[str, str] = {}
        node_ids: set[str] = set()

        # Collect ALL nodes via iter_nodes to get the full axon ID
        symbol_labels = {NodeLabel.FUNCTION, NodeLabel.CLASS, NodeLabel.METHOD,
                         NodeLabel.INTERFACE, NodeLabel.TYPE_ALIAS, NodeLabel.ENUM}
        for node in kg.iter_nodes():
            axon_id = getattr(node, "id", None) or str(node)  # e.g. "function:path/file.ts:myFunc"
            label = getattr(node, "label", None)
            # Determine node label from the axon_id prefix or node attributes
            kind = "unknown"
            for sl in symbol_labels:
                if axon_id.startswith(sl.value + ":"):
                    kind = sl.value
                    break
            if kind == "unknown":
                continue  # skip file/folder/community nodes for visualization
            name = getattr(node, "class_name", None) or axon_id.rsplit(":", 1)[-1] or axon_id
            file = getattr(node, "file_path", "") or ""
            uid = f"{file}::{name}" if file else name
            id_map[axon_id] = uid
            node_ids.add(uid)
            node_data: dict = {"id": uid, "label": name, "type": kind, "file": file, "cluster": 0}
            # Embed dead code info
            if getattr(node, "is_dead", False):
                is_exported = getattr(node, "is_exported", False)
                is_entry = getattr(node, "is_entry_point", False)
                conf, reason, safe = _classify_dead_symbol(
                    name=name, file=file, kind=kind,
                    is_exported=is_exported, is_entry_point=is_entry,
                    kg=kg, axon_id=axon_id,
                )
                node_data["isDead"] = True
                node_data["deadConfidence"] = conf
                node_data["deadReason"] = reason
                node_data["safeToDelete"] = safe
            nodes.append(node_data)

        # Collect edges from in-memory graph (only between symbol nodes)
        for rel in kg.iter_relationships():
            src = str(rel.source)
            tgt = str(rel.target)
            src_id = id_map.get(src)
            tgt_id = id_map.get(tgt)
            if src_id and tgt_id:
                edges.append({"source": src_id, "target": tgt_id, "type": rel.type.value})

        # Collect communities
        try:
            communities = kg.get_nodes_by_label(NodeLabel.COMMUNITY)
            comm_items = communities if isinstance(communities, list) else list(communities.values()) if isinstance(communities, dict) else []
            for i, _node in enumerate(comm_items):
                clusters[i] = 1
        except Exception:
            pass

    except Exception as e:
        logger.error("Pipeline run failed: %s", e, exc_info=True)

    cluster_list = [{"id": k, "size": v} for k, v in sorted(clusters.items())]
    logger.info("Graph data: %d nodes, %d edges, %d clusters", len(nodes), len(edges), len(cluster_list))
    return {"nodes": nodes, "edges": edges, "clusters": cluster_list}


def get_status(tenant_id: str, repo_id: str) -> dict:
    """Get indexing status for a repo.

    Returns:
        dict with indexed (bool), graph_path, size info
    """
    graph_path = _graph_path(tenant_id, repo_id)

    if not os.path.exists(graph_path):
        return {"indexed": False, "graph_path": graph_path}

    # Check for graph data — axoniq may store in .axon/kuzu, .kz/.db files,
    # or other structures. Also check the repo clone path for .axon directory.
    kuzu_dir = os.path.join(graph_path, ".axon", "kuzu")
    clone_axon_dir = os.path.join(DATA_DIR, "clones", tenant_id, repo_id, ".axon")
    has_graph = (
        os.path.exists(kuzu_dir)
        or os.path.exists(clone_axon_dir)
        or any(
            f.endswith(".kz") or f.endswith(".db") or f == "kuzu"
            for f in os.listdir(graph_path)
        )
        # Fallback: if graph_path has any files, analyze succeeded
        or any(os.scandir(graph_path))
    )

    # Calculate graph size (check both graph_path and clone .axon dir)
    graph_size = 0
    for search_dir in [graph_path, clone_axon_dir]:
        if os.path.exists(search_dir):
            for dirpath, _dirnames, filenames in os.walk(search_dir):
                for filename in filenames:
                    filepath = os.path.join(dirpath, filename)
                    graph_size += os.path.getsize(filepath)

    return {
        "indexed": has_graph,
        "graph_path": graph_path,
        "graph_size_bytes": graph_size,
    }


def delete_graph(tenant_id: str, repo_id: str) -> bool:
    """Delete graph data for a repo. Returns True if deleted."""
    graph_path = _graph_path(tenant_id, repo_id)
    if os.path.exists(graph_path):
        import shutil
        shutil.rmtree(graph_path)
        logger.info("Deleted graph %s", graph_path)
        return True
    return False
