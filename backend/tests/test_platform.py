"""Cross-platform regressions found by the first Windows verification run.

1. verify.ps1 passed an inline ``python -c`` snippet containing double quotes. Windows
   PowerShell 5.1 strips embedded double quotes from native-command arguments, so string
   literals became bare names (``NameError: name 'cuda' is not defined``).
2. ``/api/system`` used ``os.sysconf_names``, which does not exist on Windows; mypy (which
   type-checks for the host platform) rejected it and Windows had no memory reading at all.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ppml.system_info import total_memory_bytes, total_memory_gb

ROOT = Path(__file__).resolve().parents[2]
PS_SCRIPTS = [ROOT / "setup.ps1", ROOT / "run.ps1", ROOT / "verify.ps1", ROOT / "scripts" / "common.ps1"]


# ------------------------------------------------------------------ failure 1: PowerShell quoting
@pytest.mark.parametrize("script", PS_SCRIPTS, ids=lambda p: p.name)
def test_no_double_quotes_inside_python_c_arguments(script: Path) -> None:
    """Any ``python -c`` code passed from PowerShell must not contain double quotes."""
    text = script.read_text(encoding="utf-8")
    # Form A: array argument  '-c', '<code>'
    for code in re.findall(r"'-c',\s*'((?:[^']|'')*)'", text):
        assert '"' not in code, f"{script.name}: -c code contains a double quote: {code}"
    # Form B: inline  -c "<code>"  — the PowerShell string itself is delimited by double
    # quotes, so the code can only contain them if escaped with a backtick.
    for code in re.findall(r'-c\s+"((?:[^"`]|`.)*)"', text):
        assert '`"' not in code, f"{script.name}: -c code contains an escaped double quote: {code}"


def test_powershell_scripts_are_ascii() -> None:
    """Windows PowerShell 5.1 reads BOM-less scripts as ANSI; non-ASCII would be mangled."""
    for script in PS_SCRIPTS:
        script.read_text(encoding="utf-8").encode("ascii")


def test_check_env_script_runs() -> None:
    out = subprocess.run(  # noqa: S603 - fixed interpreter and repository script
        [sys.executable, str(ROOT / "scripts" / "check_env.py")],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert out.returncode == 0, out.stdout + out.stderr
    for name in ("torch", "opacus", "sklearn", "fastapi", "pandas", "numpy"):
        assert name in out.stdout
    assert re.search(r"cuda_available=(True|False)", out.stdout)


def test_verify_uses_check_env_script() -> None:
    text = (ROOT / "verify.ps1").read_text(encoding="utf-8")
    assert "scripts/check_env.py" in text


# ------------------------------------------------------------------ failure 2: memory detection
def test_total_memory_reported_on_this_platform() -> None:
    b = total_memory_bytes()
    assert b is not None and b > 256 * 1024 * 1024
    gb = total_memory_gb()
    assert gb is not None and gb > 0


def test_system_endpoint_reports_memory(client: TestClient) -> None:
    info = client.get("/api/system").json()
    assert isinstance(info["memory_gb"], float) and info["memory_gb"] > 0


@pytest.mark.parametrize("target", ["win32", "linux", "darwin"])
def test_backend_type_checks_for_every_platform(target: str) -> None:
    """mypy must pass for Windows, Linux and macOS, not only the platform running the tests."""
    api = pytest.importorskip("mypy.api")
    stdout, stderr, status = api.run(
        ["--config-file", str(ROOT / "mypy.ini"), "--platform", target, str(ROOT / "backend" / "ppml")]
    )
    assert status == 0, stdout + stderr
