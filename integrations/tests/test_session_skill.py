from __future__ import annotations

import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / "integrations/flowcontext-session/SKILL.md"
SCRIPT = ROOT / "integrations/flowcontext-session/scripts/register-session.sh"
FIXTURE = ROOT / "tests/fixtures/session-start.json"


def test_session_skill_requires_exactly_one_primary_topic() -> None:
    skill_text = SKILL.read_text(encoding="utf-8")
    assert "一条 Codex 任务只能登记一个主 Topic Card" in skill_text
    assert "正式更换主题必须新建 Codex 任务" in skill_text


def test_uncertain_routing_requires_question() -> None:
    skill_text = SKILL.read_text(encoding="utf-8")
    assert "高置信度" in skill_text
    assert "不确定时先询问" in skill_text or "必须先询问用户" in skill_text


def test_register_script_uses_json_file_and_registers_one_session(tmp_path: Path) -> None:
    fake_cli = tmp_path / "flowcontext"
    fake_cli.write_text(
        "#!/bin/sh\n"
        "test \"$1 $2 $3\" = 'session start --json'\n"
        "test -f \"$4\"\n"
        "printf '%s\\n' 'session started: s-fixture'\n",
        encoding="utf-8",
    )
    fake_cli.chmod(0o700)
    result = subprocess.run(
        ["bash", str(SCRIPT), "--fixture", str(FIXTURE)],
        cwd=ROOT,
        env={**os.environ, "FLOWCONTEXT_CLI": str(fake_cli)},
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "session started: s-fixture"
    assert "topic-fixture" not in result.stdout
