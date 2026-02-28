"""
Manages repository clones for axon indexing.

Handles cloning Azure DevOps repos using OAuth tokens,
fetching updates, and cleaning up stale clones.
"""

import logging
import os
import shutil
import time
from pathlib import Path

from git import Repo, GitCommandError

logger = logging.getLogger(__name__)

DATA_DIR = os.environ.get("DATA_DIR", "/data")
CLONES_DIR = os.path.join(DATA_DIR, "clones")
CLONE_DEPTH = 50


def _clone_path(tenant_id: str, repo_id: str) -> str:
    """Return filesystem path for a tenant/repo clone."""
    return os.path.join(CLONES_DIR, tenant_id, repo_id)


def _authenticated_url(clone_url: str, access_token: str) -> str:
    """Inject OAuth token into clone URL for ADO authentication.

    ADO clone URLs look like:
      https://dev.azure.com/org/project/_git/repo
    We convert to:
      https://oauth2:TOKEN@dev.azure.com/org/project/_git/repo
    """
    if clone_url.startswith("https://"):
        return clone_url.replace("https://", f"https://oauth2:{access_token}@", 1)
    return clone_url


def clone_repo(
    tenant_id: str,
    repo_id: str,
    clone_url: str,
    access_token: str,
    branch: str = "main",
) -> dict:
    """Clone a repository (shallow) or fetch updates if already cloned.

    Returns:
        dict with keys: path, cloned (bool), fetched (bool), duration_ms
    """
    path = _clone_path(tenant_id, repo_id)
    auth_url = _authenticated_url(clone_url, access_token)
    start = time.monotonic()

    if os.path.exists(os.path.join(path, ".git")) or os.path.exists(
        os.path.join(path, "HEAD")
    ):
        # Already cloned — fetch and checkout
        return _fetch_and_checkout(path, auth_url, branch, start)

    # Fresh clone
    return _fresh_clone(path, auth_url, branch, start)


def _fresh_clone(path: str, auth_url: str, branch: str, start: float) -> dict:
    """Perform a shallow clone."""
    os.makedirs(os.path.dirname(path), exist_ok=True)

    # Remove partial clone if exists
    if os.path.exists(path):
        shutil.rmtree(path)

    try:
        Repo.clone_from(
            auth_url,
            path,
            depth=CLONE_DEPTH,
            branch=branch,
            single_branch=True,
        )
    except GitCommandError as e:
        # Try without branch specification (default branch)
        logger.warning("Clone with branch=%s failed, trying default: %s", branch, e)
        if os.path.exists(path):
            shutil.rmtree(path)
        Repo.clone_from(
            auth_url,
            path,
            depth=CLONE_DEPTH,
            single_branch=True,
        )

    duration_ms = int((time.monotonic() - start) * 1000)
    logger.info("Cloned repo %s in %dms", path, duration_ms)

    return {"path": path, "cloned": True, "fetched": False, "duration_ms": duration_ms}


def _fetch_and_checkout(
    path: str, auth_url: str, branch: str, start: float
) -> dict:
    """Fetch latest changes and checkout the target branch."""
    repo = Repo(path)

    # Update remote URL (token may have changed)
    origin = repo.remotes.origin
    with origin.config_writer as cw:
        cw.set("url", auth_url)

    try:
        origin.fetch(depth=CLONE_DEPTH)
    except GitCommandError as e:
        logger.warning("Fetch failed, will try full: %s", e)
        origin.fetch()

    # Checkout target branch
    try:
        if f"origin/{branch}" in [ref.name for ref in repo.refs]:
            repo.git.checkout(f"origin/{branch}", force=True)
        else:
            logger.info("Branch %s not found, staying on current HEAD", branch)
    except GitCommandError:
        logger.warning("Checkout of %s failed, staying on HEAD", branch)

    duration_ms = int((time.monotonic() - start) * 1000)
    logger.info("Fetched repo %s in %dms", path, duration_ms)

    return {"path": path, "cloned": False, "fetched": True, "duration_ms": duration_ms}


def get_clone_path(tenant_id: str, repo_id: str) -> str | None:
    """Return clone path if it exists, None otherwise."""
    path = _clone_path(tenant_id, repo_id)
    if os.path.exists(path):
        return path
    return None


def delete_clone(tenant_id: str, repo_id: str) -> bool:
    """Delete a repository clone. Returns True if deleted."""
    path = _clone_path(tenant_id, repo_id)
    if os.path.exists(path):
        shutil.rmtree(path)
        logger.info("Deleted clone %s", path)
        return True
    return False


def cleanup_stale_clones(max_age_days: int = 30) -> list[str]:
    """Remove clones not accessed in max_age_days. Returns list of removed paths."""
    removed = []
    cutoff = time.time() - (max_age_days * 86400)

    if not os.path.exists(CLONES_DIR):
        return removed

    for tenant_dir in Path(CLONES_DIR).iterdir():
        if not tenant_dir.is_dir():
            continue
        for repo_dir in tenant_dir.iterdir():
            if not repo_dir.is_dir():
                continue
            # Use directory modification time as proxy for last access
            if repo_dir.stat().st_mtime < cutoff:
                shutil.rmtree(repo_dir)
                removed.append(str(repo_dir))
                logger.info("Cleaned up stale clone: %s", repo_dir)

    return removed
