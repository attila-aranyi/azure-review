"""Tests for the FastAPI sidecar HTTP endpoints."""

import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


class TestHealth:
    def test_health_returns_ok(self):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["service"] == "axon-sidecar"


class TestIndexRepo:
    @patch("main.graph_manager.analyze")
    @patch("main.repo_manager.clone_repo")
    def test_index_success(self, mock_clone, mock_analyze, temp_data_dir):
        mock_clone.return_value = {
            "path": "/data/clones/t1/r1",
            "cloned": True,
            "fetched": False,
            "duration_ms": 1500,
        }
        mock_analyze.return_value = {
            "status": "ready",
            "duration_ms": 3000,
            "symbols": 100,
            "edges": 200,
            "clusters": 5,
        }

        response = client.post(
            "/repos/t1/r1/index",
            json={
                "clone_url": "https://dev.azure.com/org/proj/_git/repo",
                "access_token": "token",
                "branch": "main",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ready"
        assert data["symbols"] == 100
        assert data["duration_ms"] == 4500
        assert data["clone_duration_ms"] == 1500
        assert data["analyze_duration_ms"] == 3000

    @patch("main.graph_manager.analyze")
    @patch("main.repo_manager.clone_repo")
    def test_index_analyze_failure(self, mock_clone, mock_analyze, temp_data_dir):
        mock_clone.return_value = {
            "path": "/data/clones/t1/r1",
            "cloned": True,
            "fetched": False,
            "duration_ms": 1000,
        }
        mock_analyze.return_value = {
            "status": "failed",
            "error": "unsupported language",
            "duration_ms": 500,
        }

        response = client.post(
            "/repos/t1/r1/index",
            json={
                "clone_url": "https://dev.azure.com/org/proj/_git/repo",
                "access_token": "token",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "failed"
        assert data["error"] == "unsupported language"


class TestReindexRepo:
    @patch("main.graph_manager.analyze")
    @patch("main.repo_manager.clone_repo")
    @patch("main.repo_manager.get_clone_path")
    def test_reindex_success(self, mock_path, mock_clone, mock_analyze, temp_data_dir):
        mock_path.return_value = "/data/clones/t1/r1"
        mock_clone.return_value = {
            "path": "/data/clones/t1/r1",
            "cloned": False,
            "fetched": True,
            "duration_ms": 500,
        }
        mock_analyze.return_value = {
            "status": "ready",
            "duration_ms": 1000,
            "symbols": 110,
            "edges": 220,
            "clusters": 5,
        }

        response = client.post(
            "/repos/t1/r1/reindex",
            json={"access_token": "token", "branch": "main"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ready"
        assert data["symbols"] == 110

    @patch("main.repo_manager.get_clone_path")
    def test_reindex_not_indexed(self, mock_path, temp_data_dir):
        mock_path.return_value = None

        response = client.post(
            "/repos/t1/r1/reindex",
            json={"access_token": "token"},
        )

        assert response.status_code == 404


class TestDetectChanges:
    @patch("main.graph_manager.detect_changes")
    @patch("main.repo_manager.get_clone_path")
    def test_detect_changes_success(self, mock_path, mock_detect, temp_data_dir):
        mock_path.return_value = "/data/clones/t1/r1"
        mock_detect.return_value = {
            "changed_symbols": [
                {"file": "src/main.py", "name": "process", "type": "function"},
            ]
        }

        response = client.post(
            "/repos/t1/r1/detect-changes",
            json={"diff": "--- a/main.py\n+++ b/main.py\n@@ -1 +1 @@"},
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["changed_symbols"]) == 1

    @patch("main.repo_manager.get_clone_path")
    def test_detect_changes_not_indexed(self, mock_path, temp_data_dir):
        mock_path.return_value = None
        response = client.post(
            "/repos/t1/r1/detect-changes",
            json={"diff": "some diff"},
        )
        assert response.status_code == 404


class TestImpact:
    @patch("main.graph_manager.get_impact")
    @patch("main.repo_manager.get_clone_path")
    def test_impact_success(self, mock_path, mock_impact, temp_data_dir):
        mock_path.return_value = "/data/clones/t1/r1"
        mock_impact.return_value = {
            "blast_radius": {
                "depth_1": [{"name": "caller1", "file": "a.py"}],
            }
        }

        response = client.post(
            "/repos/t1/r1/impact",
            json={"symbol": "myFunc", "depth": 3},
        )

        assert response.status_code == 200
        assert "blast_radius" in response.json()


class TestContext:
    @patch("main.graph_manager.get_context")
    @patch("main.repo_manager.get_clone_path")
    def test_context_success(self, mock_path, mock_context, temp_data_dir):
        mock_path.return_value = "/data/clones/t1/r1"
        mock_context.return_value = {
            "callers": [{"name": "main"}],
            "callees": [],
            "types": [],
            "community": {"id": 1, "name": "Core"},
        }

        response = client.post(
            "/repos/t1/r1/context",
            json={"symbol": "process"},
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["callers"]) == 1


class TestDeadCode:
    @patch("main.graph_manager.get_dead_code")
    @patch("main.repo_manager.get_clone_path")
    def test_dead_code_success(self, mock_path, mock_dead, temp_data_dir):
        mock_path.return_value = "/data/clones/t1/r1"
        mock_dead.return_value = {
            "dead_symbols": [{"file": "old.py", "name": "unused", "type": "function"}]
        }

        response = client.post("/repos/t1/r1/dead-code")

        assert response.status_code == 200
        assert len(response.json()["dead_symbols"]) == 1


class TestStatus:
    @patch("main.graph_manager.get_status")
    def test_status_not_indexed(self, mock_status, temp_data_dir):
        mock_status.return_value = {"indexed": False, "graph_size_bytes": 0}

        response = client.get("/repos/t1/r1/status")

        assert response.status_code == 200
        assert response.json()["indexed"] is False

    @patch("main.graph_manager.get_status")
    def test_status_indexed(self, mock_status, temp_data_dir):
        mock_status.return_value = {"indexed": True, "graph_size_bytes": 1024}

        response = client.get("/repos/t1/r1/status")

        assert response.status_code == 200
        data = response.json()
        assert data["indexed"] is True
        assert data["graph_size_bytes"] == 1024


class TestDeleteRepo:
    @patch("main.repo_manager.delete_clone")
    @patch("main.graph_manager.delete_graph")
    def test_delete_success(self, mock_graph, mock_clone, temp_data_dir):
        mock_graph.return_value = True
        mock_clone.return_value = True

        response = client.delete("/repos/t1/r1")

        assert response.status_code == 200
        data = response.json()
        assert data["deleted"] is True
        assert data["graph_deleted"] is True
        assert data["clone_deleted"] is True

    @patch("main.repo_manager.delete_clone")
    @patch("main.graph_manager.delete_graph")
    def test_delete_not_found(self, mock_graph, mock_clone, temp_data_dir):
        mock_graph.return_value = False
        mock_clone.return_value = False

        response = client.delete("/repos/t1/r1")

        assert response.status_code == 404
