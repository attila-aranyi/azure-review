"""Tests for repo_manager module."""

import os
import shutil
from unittest.mock import MagicMock, patch

import pytest

import repo_manager


class TestAuthenticatedUrl:
    def test_injects_token_into_https_url(self):
        url = "https://dev.azure.com/org/project/_git/repo"
        result = repo_manager._authenticated_url(url, "my-token")
        assert result == "https://oauth2:my-token@dev.azure.com/org/project/_git/repo"

    def test_preserves_non_https_url(self):
        url = "git@dev.azure.com:org/project/_git/repo"
        result = repo_manager._authenticated_url(url, "my-token")
        assert result == url


class TestClonePath:
    def test_returns_correct_path(self, temp_data_dir):
        path = repo_manager._clone_path("tenant-1", "repo-1")
        assert path == os.path.join(temp_data_dir, "clones", "tenant-1", "repo-1")


class TestCloneRepo:
    @patch("repo_manager.Repo")
    def test_fresh_clone_calls_clone_from(self, mock_repo_cls, temp_data_dir):
        mock_repo_cls.clone_from = MagicMock()

        result = repo_manager.clone_repo(
            tenant_id="t1",
            repo_id="r1",
            clone_url="https://dev.azure.com/org/proj/_git/repo",
            access_token="token-123",
            branch="main",
        )

        assert result["cloned"] is True
        assert result["fetched"] is False
        assert result["duration_ms"] >= 0
        mock_repo_cls.clone_from.assert_called_once()

        call_args = mock_repo_cls.clone_from.call_args
        assert "oauth2:token-123" in call_args[0][0]
        assert call_args[1]["depth"] == 50
        assert call_args[1]["branch"] == "main"

    @patch("repo_manager.Repo")
    def test_existing_clone_fetches_instead(self, mock_repo_cls, temp_data_dir):
        # Create a fake .git directory
        clone_path = repo_manager._clone_path("t1", "r1")
        os.makedirs(os.path.join(clone_path, ".git"), exist_ok=True)

        mock_repo_instance = MagicMock()
        mock_origin = MagicMock()
        mock_origin.config_writer.__enter__ = MagicMock(return_value=MagicMock())
        mock_origin.config_writer.__exit__ = MagicMock(return_value=False)
        mock_repo_instance.remotes.origin = mock_origin
        mock_repo_instance.refs = []
        mock_repo_cls.return_value = mock_repo_instance

        result = repo_manager.clone_repo(
            tenant_id="t1",
            repo_id="r1",
            clone_url="https://dev.azure.com/org/proj/_git/repo",
            access_token="token-123",
            branch="main",
        )

        assert result["cloned"] is False
        assert result["fetched"] is True
        mock_origin.fetch.assert_called_once()

    @patch("repo_manager.Repo")
    def test_clone_fallback_on_branch_failure(self, mock_repo_cls, temp_data_dir):
        from git import GitCommandError

        # First call fails (branch not found), second succeeds
        mock_repo_cls.clone_from = MagicMock(
            side_effect=[GitCommandError("clone", "branch not found"), MagicMock()]
        )

        result = repo_manager.clone_repo(
            tenant_id="t1",
            repo_id="r1",
            clone_url="https://dev.azure.com/org/proj/_git/repo",
            access_token="token-123",
            branch="nonexistent",
        )

        assert result["cloned"] is True
        assert mock_repo_cls.clone_from.call_count == 2


class TestGetClonePath:
    def test_returns_none_when_not_cloned(self, temp_data_dir):
        assert repo_manager.get_clone_path("t1", "r1") is None

    def test_returns_path_when_cloned(self, temp_data_dir):
        clone_path = repo_manager._clone_path("t1", "r1")
        os.makedirs(clone_path, exist_ok=True)
        assert repo_manager.get_clone_path("t1", "r1") == clone_path


class TestDeleteClone:
    def test_returns_false_when_not_found(self, temp_data_dir):
        assert repo_manager.delete_clone("t1", "r1") is False

    def test_deletes_and_returns_true(self, temp_data_dir):
        clone_path = repo_manager._clone_path("t1", "r1")
        os.makedirs(clone_path, exist_ok=True)
        assert repo_manager.delete_clone("t1", "r1") is True
        assert not os.path.exists(clone_path)


class TestCleanupStaleClones:
    def test_removes_old_clones(self, temp_data_dir):
        # Create a clone dir with old mtime
        clone_path = repo_manager._clone_path("t1", "old-repo")
        os.makedirs(clone_path, exist_ok=True)
        # Set mtime to 60 days ago
        old_time = os.path.getmtime(clone_path) - (60 * 86400)
        os.utime(clone_path, (old_time, old_time))

        removed = repo_manager.cleanup_stale_clones(max_age_days=30)
        assert len(removed) == 1
        assert "old-repo" in removed[0]

    def test_keeps_recent_clones(self, temp_data_dir):
        clone_path = repo_manager._clone_path("t1", "new-repo")
        os.makedirs(clone_path, exist_ok=True)

        removed = repo_manager.cleanup_stale_clones(max_age_days=30)
        assert len(removed) == 0
