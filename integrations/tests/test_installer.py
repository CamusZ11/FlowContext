from __future__ import annotations

import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
INSTALLER = ROOT / "scripts/install-integrations.mjs"


def run_installer(skills_root: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", str(INSTALLER), "--skills-root", str(skills_root), *extra],
        cwd=ROOT,
        env=dict(os.environ),
        capture_output=True,
        text=True,
        check=False,
    )


def test_installer_refuses_unmanaged_existing_directory(tmp_path: Path) -> None:
    target = tmp_path / "generating-handoff"
    target.mkdir(parents=True)
    (target / "user-file.txt").write_text("keep", encoding="utf-8")
    result = run_installer(tmp_path, "--apply", "--confirmed")
    assert result.returncode != 0
    assert (target / "user-file.txt").read_text(encoding="utf-8") == "keep"


def test_dry_run_lists_missing_targets_without_writing(tmp_path: Path) -> None:
    result = run_installer(tmp_path, "--dry-run")
    assert result.returncode == 0, result.stderr
    assert "dry-run only" in result.stdout
    assert not (tmp_path / "flowcontext-session").exists()


def test_apply_requires_explicit_confirmation(tmp_path: Path) -> None:
    result = run_installer(tmp_path, "--apply")
    assert result.returncode == 2
    assert not (tmp_path / "flowcontext-session").exists()


def test_apply_creates_only_canonical_links(tmp_path: Path) -> None:
    result = run_installer(tmp_path, "--apply", "--confirmed")
    assert result.returncode == 0, result.stderr
    for name in ("flowcontext-session", "generating-handoff"):
        link = tmp_path / name
        assert link.is_symlink()
        assert link.resolve() == ROOT / "integrations" / name


def test_apply_is_idempotent_for_existing_canonical_links(tmp_path: Path) -> None:
    first = run_installer(tmp_path, "--apply", "--confirmed")
    second = run_installer(tmp_path, "--apply", "--confirmed")
    assert first.returncode == 0, first.stderr
    assert second.returncode == 0, second.stderr
    assert "already-points-to-FlowContext" in second.stdout
