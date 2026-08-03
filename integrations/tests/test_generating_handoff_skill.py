from __future__ import annotations

import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / "integrations/generating-handoff/SKILL.md"
SCRIPT = ROOT / "integrations/generating-handoff/scripts/persist-handoff.sh"
FIXTURE = ROOT / "tests/fixtures/handoff.json"


def test_pause_and_finish_are_identical_triggers() -> None:
    skill_text = SKILL.read_text(encoding="utf-8")
    assert "放一放" in skill_text and "收工" in skill_text
    assert "语义完全相同" in skill_text


def test_done_requires_explicit_topic_end() -> None:
    skill_text = SKILL.read_text(encoding="utf-8")
    assert "只有用户明确表达主题结束" in skill_text
    assert "生成 Handoff 不得标记 Topic Card done" in skill_text


def test_persistence_happens_after_confirmation() -> None:
    skill_text = SKILL.read_text(encoding="utf-8")
    assert skill_text.index("展示 Handoff 草稿") < skill_text.index("写入云数据库")


def test_persist_wrapper_retries_same_fixture_idempotently(tmp_path: Path) -> None:
    fake_cli = tmp_path / "flowcontext"
    fake_cli.write_text(
        "#!/bin/sh\n"
        "test \"$1 $2 $3\" = 'handoff create --json'\n"
        "test -f \"$4\"\n"
        "printf '%s\\n' 'handoff persisted: h-fixture'\n",
        encoding="utf-8",
    )
    fake_cli.chmod(0o700)
    outputs = []
    for _ in range(2):
        result = subprocess.run(
            ["bash", str(SCRIPT), str(FIXTURE)],
            cwd=ROOT,
            env={**os.environ, "FLOWCONTEXT_CLI": str(fake_cli)},
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr
        outputs.append(result.stdout.strip())
    assert outputs == ["handoff persisted: h-fixture", "handoff persisted: h-fixture"]
