"""Shared test fixtures for axon sidecar tests."""

import os
import tempfile

import pytest


@pytest.fixture(autouse=True)
def temp_data_dir(tmp_path, monkeypatch):
    """Set DATA_DIR to a temp directory for all tests."""
    data_dir = str(tmp_path / "data")
    os.makedirs(data_dir, exist_ok=True)
    monkeypatch.setenv("DATA_DIR", data_dir)

    # Also patch the module-level variables
    import repo_manager
    import graph_manager

    monkeypatch.setattr(repo_manager, "DATA_DIR", data_dir)
    monkeypatch.setattr(repo_manager, "CLONES_DIR", os.path.join(data_dir, "clones"))
    monkeypatch.setattr(graph_manager, "DATA_DIR", data_dir)
    monkeypatch.setattr(graph_manager, "GRAPHS_DIR", os.path.join(data_dir, "graphs"))

    return data_dir
