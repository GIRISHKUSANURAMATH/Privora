"""Cross-platform regressions found by the first Windows verification run.

1. verify.ps1 passed an inline ``python -c`` snippet containing double quotes. Windows
   PowerShell 5.1 strips embedded double quotes from native-command arguments, so string
   literals became bare names (``NameError: name 'cuda' is not defined``).
2. ``/api/system`` used ``os.sysconf_names``, which does not exist on Windows; mypy (which
   type-checks for the host platform) rejected it and Windows had no memory reading at all.
"""

from __future__ import annotations

import os
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


# --------------------------------------- Windows code page: piped output must be encodable
# On Windows, Python writes piped or redirected stdout in the legacy code page (e.g. cp1252).
# run_experiments.py printed "→", which raised UnicodeEncodeError when capture_screenshots.py
# ran under the release check, so no screenshot was taken.
OUTPUT_CALLS = {"print", "write", "debug", "info", "warning", "error", "exception", "critical"}


def _non_ascii_output_strings(path: Path) -> list[str]:
    import ast

    hits = []
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if not isinstance(node, ast.Call):
            continue
        name = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
        if name not in OUTPUT_CALLS:
            continue
        for sub in ast.walk(node):
            if isinstance(sub, ast.Constant) and isinstance(sub.value, str) and not sub.value.isascii():
                hits.append(f"{path.relative_to(ROOT)}:{sub.lineno}: {sub.value!r}")
    return hits


def test_console_output_strings_are_ascii() -> None:
    files = sorted((ROOT / "scripts").glob("*.py")) + sorted((ROOT / "backend" / "ppml").rglob("*.py"))
    assert len(files) > 20
    hits = [h for f in files for h in _non_ascii_output_strings(f)]
    message = "non-ASCII text in console/log output breaks piped output on Windows:\n"
    assert hits == [], message + "\n".join(hits)


_PRINT_EXPERIMENT_NAME = (
    "import sys; sys.path.insert(0, sys.argv[1]); import run_experiments as rx; "
    "{setup}print('-> ' + 'Experiment A \\u00b7 Conventional vs DP (\\u03b5=3)', flush=True)"
)


def _run_with_cp1252(code: str) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "PYTHONIOENCODING": "cp1252"}
    return subprocess.run(  # noqa: S603 - fixed interpreter, code defined in this test
        [sys.executable, "-c", code, str(ROOT / "scripts")],
        capture_output=True,
        text=True,
        encoding="cp1252",
        errors="strict",
        timeout=120,
        check=False,
        env=env,
    )


def test_experiment_names_crash_a_cp1252_pipe_without_the_fix() -> None:
    """Sanity check that the test reproduces the Windows failure (data, not code, is non-ASCII)."""
    out = _run_with_cp1252(_PRINT_EXPERIMENT_NAME.format(setup=""))
    assert out.returncode != 0 and "UnicodeEncodeError" in out.stderr


def test_configure_console_makes_experiment_names_safe_on_cp1252() -> None:
    out = _run_with_cp1252(_PRINT_EXPERIMENT_NAME.format(setup="rx.configure_console(); "))
    assert out.returncode == 0, out.stderr
    assert "\\u03b5=3" in out.stdout


@pytest.mark.parametrize("script", ["run_experiments.py", "capture_screenshots.py"])
def test_script_entry_points_configure_the_console_first(script: str) -> None:
    import ast

    tree = ast.parse((ROOT / "scripts" / script).read_text(encoding="utf-8"))
    main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main")
    first = main.body[0]
    assert isinstance(first, ast.Expr) and isinstance(first.value, ast.Call)
    func = first.value.func
    assert (getattr(func, "id", None) or getattr(func, "attr", None)) == "configure_console"


def test_check_env_runs_with_a_legacy_windows_code_page() -> None:
    env = {**os.environ, "PYTHONIOENCODING": "cp1252"}
    out = subprocess.run(  # noqa: S603 - fixed interpreter and repository script
        [sys.executable, str(ROOT / "scripts" / "check_env.py")],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
        env=env,
    )
    assert out.returncode == 0, out.stdout + out.stderr


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
