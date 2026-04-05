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
        output = _run_axon(
            ["analyze", repo_path, "--output-format", "json"],
            cwd=repo_path,
            timeout=ANALYZE_TIMEOUT,
            env_extra={"AXON_GRAPH_DIR": graph_path},
        )
    except AxonError:
        # Retry without JSON output format (fallback for older axon versions)
        try:
            output = _run_axon(
                ["analyze", repo_path],
                cwd=repo_path,
                timeout=ANALYZE_TIMEOUT,
                env_extra={"AXON_GRAPH_DIR": graph_path},
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


def get_dead_code(
    tenant_id: str,
    repo_id: str,
    repo_path: str,
) -> dict:
    """Detect dead/unreachable code in the repository.

    Returns:
        dict with dead_symbols list
    """
    graph_path = _graph_path(tenant_id, repo_id)

    try:
        output = _run_axon(
            ["dead-code", "--output-format", "json"],
            cwd=repo_path,
            env_extra={"AXON_GRAPH_DIR": graph_path},
        )
        data = json.loads(output)
        return {"dead_symbols": data.get("dead_symbols", data.get("dead_code", []))}
    except (AxonError, json.JSONDecodeError) as e:
        logger.warning("dead-code query failed: %s", e)
        return {"dead_symbols": []}


def get_graph_data(tenant_id: str, repo_id: str, repo_path: str) -> dict:
    """Return the full graph for visualization: nodes, edges, clusters.

    Uses axoniq Python API directly instead of CLI commands.
    """
    nodes = []
    edges = []
    clusters: dict[int, int] = {}

    try:
        import axoniq

        # Use axoniq Python API to read the indexed graph
        ax = axoniq.load(repo_path)
        symbols = ax.symbols() if hasattr(ax, "symbols") else []

        for sym in symbols:
            name = getattr(sym, "name", str(sym))
            kind = getattr(sym, "kind", "unknown")
            file = getattr(sym, "file", "")
            cluster = getattr(sym, "cluster_id", getattr(sym, "cluster", 0)) or 0
            node_id = f"{file}::{name}" if file else name
            nodes.append({"id": node_id, "label": name, "type": kind, "file": file, "cluster": cluster})
            clusters[cluster] = clusters.get(cluster, 0) + 1

            # Get edges from callers/callees
            callees = getattr(sym, "callees", None)
            if callees:
                for callee in callees:
                    callee_name = getattr(callee, "name", str(callee))
                    callee_file = getattr(callee, "file", "")
                    tgt_id = f"{callee_file}::{callee_name}" if callee_file else callee_name
                    edges.append({"source": node_id, "target": tgt_id, "type": "CALLS"})

    except Exception as e:
        logger.warning("axoniq Python API failed, trying CLI: %s", e)

        # Fallback: try axon CLI commands
        graph_path = _graph_path(tenant_id, repo_id)
        try:
            # Try 'axon query' to list all symbols
            output = _run_axon(
                ["query", "--all", "--output-format", "json"],
                cwd=repo_path,
                env_extra={"AXON_GRAPH_DIR": graph_path},
                timeout=60,
            )
            import json as _json
            data = _json.loads(output)
            items = data if isinstance(data, list) else data.get("results", data.get("symbols", []))
            for item in items:
                name = item.get("name", "")
                kind = item.get("kind", item.get("type", "unknown"))
                file = item.get("file", "")
                cluster = item.get("cluster_id", item.get("cluster", 0)) or 0
                node_id = f"{file}::{name}" if file else name
                nodes.append({"id": node_id, "label": name, "type": kind, "file": file, "cluster": cluster})
                clusters[cluster] = clusters.get(cluster, 0) + 1
        except Exception as e2:
            logger.warning("CLI fallback also failed: %s", e2)

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
