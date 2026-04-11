"""Tests for graph_manager module."""

import json
import os
from unittest.mock import MagicMock, patch

import pytest

import graph_manager
from graph_manager import AxonError


class TestRunAxon:
    @patch("graph_manager.subprocess.run")
    def test_returns_stdout_on_success(self, mock_run, temp_data_dir):
        mock_run.return_value = MagicMock(returncode=0, stdout="output", stderr="")
        result = graph_manager._run_axon(["analyze", "."], cwd="/tmp")
        assert result == "output"

    @patch("graph_manager.subprocess.run")
    def test_raises_on_nonzero_exit(self, mock_run, temp_data_dir):
        mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="error msg")
        with pytest.raises(AxonError, match="axon command failed"):
            graph_manager._run_axon(["analyze", "."], cwd="/tmp")

    @patch("graph_manager.subprocess.run")
    def test_raises_on_timeout(self, mock_run, temp_data_dir):
        import subprocess
        mock_run.side_effect = subprocess.TimeoutExpired(cmd="axon", timeout=60)
        with pytest.raises(AxonError, match="timed out"):
            graph_manager._run_axon(["analyze", "."], cwd="/tmp")

    @patch("graph_manager.subprocess.run")
    def test_raises_on_file_not_found(self, mock_run, temp_data_dir):
        mock_run.side_effect = FileNotFoundError()
        with pytest.raises(AxonError, match="not found"):
            graph_manager._run_axon(["analyze", "."], cwd="/tmp")


class TestAnalyze:
    @patch("graph_manager.get_dead_code", return_value={"dead_symbols": []})
    @patch("graph_manager._run_axon")
    def test_returns_ready_on_success(self, mock_run, _mock_dead, temp_data_dir):
        mock_run.return_value = json.dumps(
            {"symbols": 100, "edges": 200, "clusters": 5}
        )

        result = graph_manager.analyze("t1", "r1", "/tmp/repo")

        assert result["status"] == "ready"
        assert result["symbols"] == 100
        assert result["edges"] == 200
        assert result["clusters"] == 5
        assert result["duration_ms"] >= 0

    @patch("graph_manager._run_axon")
    def test_returns_failed_on_error(self, mock_run, temp_data_dir):
        mock_run.side_effect = AxonError("analyze failed")

        result = graph_manager.analyze("t1", "r1", "/tmp/repo")
        assert result["status"] == "failed"
        assert "analyze failed" in result["error"]

    @patch("graph_manager.get_dead_code", return_value={"dead_symbols": []})
    @patch("graph_manager._run_axon")
    def test_handles_text_output(self, mock_run, _mock_dead, temp_data_dir):
        mock_run.return_value = "Indexed 50 symbols\nFound 80 edges\nDetected 3 clusters"

        result = graph_manager.analyze("t1", "r1", "/tmp/repo")
        assert result["status"] == "ready"
        assert result["symbols"] == 50
        assert result["edges"] == 80
        assert result["clusters"] == 3


class TestDetectChanges:
    @patch("graph_manager._run_axon")
    def test_returns_changed_symbols(self, mock_run, temp_data_dir):
        mock_run.return_value = json.dumps(
            {
                "changed_symbols": [
                    {"file": "src/main.py", "name": "process", "type": "function"},
                ]
            }
        )

        result = graph_manager.detect_changes("t1", "r1", "/tmp/repo", "diff content")
        assert len(result["changed_symbols"]) == 1
        assert result["changed_symbols"][0]["name"] == "process"

    @patch("graph_manager._run_axon")
    def test_returns_empty_on_failure(self, mock_run, temp_data_dir):
        mock_run.side_effect = AxonError("failed")

        result = graph_manager.detect_changes("t1", "r1", "/tmp/repo", "diff")
        assert result["changed_symbols"] == []


class TestGetImpact:
    @patch("graph_manager._run_axon")
    def test_returns_blast_radius(self, mock_run, temp_data_dir):
        mock_run.return_value = json.dumps(
            {
                "blast_radius": {
                    "depth_1": [{"name": "caller", "file": "a.py"}],
                }
            }
        )

        result = graph_manager.get_impact("t1", "r1", "/tmp/repo", "myFunc")
        assert "depth_1" in result["blast_radius"]

    @patch("graph_manager._run_axon")
    def test_returns_empty_on_failure(self, mock_run, temp_data_dir):
        mock_run.side_effect = AxonError("failed")

        result = graph_manager.get_impact("t1", "r1", "/tmp/repo", "missing")
        assert result["blast_radius"] == {}


class TestGetContext:
    @patch("graph_manager._run_axon")
    def test_returns_context(self, mock_run, temp_data_dir):
        mock_run.return_value = json.dumps(
            {"callers": [{"name": "main"}], "callees": [], "types": [], "community": {"id": 1, "name": "Core"}}
        )

        result = graph_manager.get_context("t1", "r1", "/tmp/repo", "myFunc")
        assert result["callers"][0]["name"] == "main"

    @patch("graph_manager._run_axon")
    def test_returns_empty_on_failure(self, mock_run, temp_data_dir):
        mock_run.side_effect = AxonError("failed")

        result = graph_manager.get_context("t1", "r1", "/tmp/repo", "missing")
        assert result["callers"] == []
        assert result["community"] is None


class TestGetDeadCode:
    @patch("graph_manager._scan_dead_nodes")
    @patch("graph_manager._get_cached_kg")
    def test_returns_dead_symbols(self, mock_kg, mock_scan, temp_data_dir):
        mock_kg.return_value = MagicMock()
        mock_scan.return_value = [
            {"file": "src/old.py", "name": "unused_func", "type": "function",
             "confidence": "high", "reason": "Private function with no callers — safe to remove",
             "safeToDelete": True, "line": 10},
        ]

        result = graph_manager.get_dead_code("t1", "r1", "/tmp/repo")
        assert len(result["dead_symbols"]) == 1
        assert result["dead_symbols"][0]["name"] == "unused_func"
        assert result["dead_symbols"][0]["confidence"] == "high"
        assert result["dead_symbols"][0]["safeToDelete"] is True

    @patch("graph_manager._get_cached_kg")
    def test_returns_empty_on_failure(self, mock_kg, temp_data_dir):
        mock_kg.return_value = None

        result = graph_manager.get_dead_code("t1", "r1", "/tmp/repo")
        assert result["dead_symbols"] == []


class TestGetStatus:
    def test_returns_not_indexed_when_no_graph(self, temp_data_dir):
        result = graph_manager.get_status("t1", "r1")
        assert result["indexed"] is False

    def test_returns_indexed_when_graph_exists(self, temp_data_dir):
        graph_path = graph_manager._graph_path("t1", "r1")
        kuzu_dir = os.path.join(graph_path, ".axon", "kuzu")
        os.makedirs(kuzu_dir, exist_ok=True)
        # Create a dummy file
        with open(os.path.join(kuzu_dir, "test.db"), "w") as f:
            f.write("test")

        result = graph_manager.get_status("t1", "r1")
        assert result["indexed"] is True
        assert result["graph_size_bytes"] > 0


class TestDeleteGraph:
    def test_deletes_existing_graph(self, temp_data_dir):
        graph_path = graph_manager._graph_path("t1", "r1")
        os.makedirs(graph_path)
        with open(os.path.join(graph_path, "test.db"), "w") as f:
            f.write("test")

        assert graph_manager.delete_graph("t1", "r1") is True
        assert not os.path.exists(graph_path)

    def test_returns_false_when_no_graph(self, temp_data_dir):
        assert graph_manager.delete_graph("t1", "nonexistent") is False
