r"""Regenerate the README screenshots from a fresh, isolated Privora instance.

Optional tooling (Playwright downloads its own browser, so it is not in requirements-dev.txt):
    .\.venv\Scripts\python.exe -m pip install playwright
    .\.venv\Scripts\python.exe -m playwright install chromium
Build the UI first (setup.ps1, or `npm run build` in frontend/), then:
    .\.venv\Scripts\python.exe scripts\capture_screenshots.py            # writes screenshots-capture/
    .\.venv\Scripts\python.exe scripts\capture_screenshots.py --out DIR

What it does:
  1. Starts the backend on a free 127.0.0.1 port with a new temporary data folder, so the project's
     data/ folder and docs/results/experiments.json are never read or written.
  2. Runs the reference experiments from scripts/run_experiments.py against that instance
     (same configurations; results are written only inside the temporary folder).
  3. Captures the 18 screenshots and checks every page: no console or page errors, no horizontal
     overflow at the requested width, document title and visible text say "Privora", and no
     text contains the former product name. Layout probes also check that no element sticks out
     of its container, chart labels do not overlap each other or data points, numeric axis
     labels sit at the positions they name, notifications have cleared before the shot, and
     every sidebar item can be reached above the footer (also at 1280 x 720, 600 and 480).
  4. Uses the report that run_experiments.py already wrote for the Reports screenshot (preview,
     not generate) and fails if the number of saved reports changes unexpectedly.
  5. Checks that every PNG has only IHDR, IDAT and IEND chunks (no embedded metadata).
  6. Stops the backend and deletes the temporary folder.
It never writes to assets/screenshots/. Review the output, then copy it there yourself.
Exit code 0 only if every check passed.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import struct
import subprocess  # nosec B404
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import TYPE_CHECKING, Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import run_experiments as rx

if TYPE_CHECKING:  # Playwright is optional tooling; these names are only used in annotations.
    from playwright.sync_api import ConsoleMessage, Page, ViewportSize
    from playwright.sync_api import Error as PlaywrightError

PRODUCT = "Privora"
FORMER_NAME = "umbra"
PNG_SIG = b"\x89PNG\r\n\x1a\n"


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def get_json(base: str, path: str) -> Any:
    if not path.startswith("/api/"):
        raise ValueError("path must be an /api/ route")
    # base is always the http://127.0.0.1:<port> instance this script started; path is an /api/ route.
    with urllib.request.urlopen(base + path, timeout=30) as r:  # noqa: S310  # nosec B310
        return json.loads(r.read().decode())


def png_chunk_types(path: Path) -> list[str]:
    data = path.read_bytes()
    if data[:8] != PNG_SIG:
        raise ValueError("not a PNG")
    types, i = [], 8
    while i < len(data):
        (n,) = struct.unpack(">I", data[i : i + 4])
        types.append(data[i + 4 : i + 8].decode("latin1"))
        i += 12 + n
    return types


# ----------------------------------------------------------------------------- reports
def reports_page_action(existing_reports: int) -> str:
    """Preview an existing report; generate one only when none exists (never a duplicate)."""
    return "preview" if existing_reports > 0 else "generate"


def report_count_problems(before: int, after: int, mode: str) -> list[str]:
    expected = before + (1 if mode == "generate" else 0)
    if after == expected:
        return []
    return [f"saved reports went from {before} to {after} (expected {expected} after '{mode}')"]


# ----------------------------------------------------------------------------- browser probes
# Browser-side probes live in capture_probes.js; each returns a list of human-readable problems.
PROBES_FILE = Path(__file__).with_name("capture_probes.js")


def load_probe(name: str) -> str:
    text = PROBES_FILE.read_text(encoding="utf-8")
    m = re.search(rf"^// @probe {re.escape(name)}\n(.*?)^// @end", text, re.S | re.M)
    if not m:
        raise KeyError(f"probe {name!r} not found in {PROBES_FILE.name}")
    return m.group(1).strip()


LAYOUT_PROBE_JS = load_probe("layout")
SIDEBAR_PROBE_JS = load_probe("sidebar")
NO_TOASTS_JS = "() => !document.querySelector('[data-toasts] [role=status], [data-toasts] [role=alert]')"


def settle_notifications(page: Any, timeout_ms: int = 15000) -> list[str]:
    """Report error notifications, then wait for every notification to close before the shot."""
    errors = page.eval_on_selector_all("[data-toasts] [role=alert]", "els => els.map(e => e.innerText)")
    issues = [f"error notification: {' '.join(e.split())[:160]}" for e in errors]
    from playwright.sync_api import TimeoutError as PlaywrightTimeout

    try:
        page.wait_for_function(NO_TOASTS_JS, timeout=timeout_ms)
    except PlaywrightTimeout:
        issues.append(f"a notification was still on screen after {timeout_ms // 1000} s")
    return issues


OVERFLOW_CULPRIT_JS = load_probe("overflow")


def overflow_culprit(page: Any) -> str:
    return str(page.evaluate(OVERFLOW_CULPRIT_JS))


def collect_page_errors(page: Page, *, console: bool = True) -> list[str]:
    """Record uncaught page errors (and console errors) in a list that fills while the page runs."""
    errors: list[str] = []

    def on_console(message: ConsoleMessage) -> None:
        if message.type == "error":
            errors.append(message.text)

    def on_page_error(error: PlaywrightError) -> None:
        errors.append(str(error))

    if console:
        page.on("console", on_console)
    page.on("pageerror", on_page_error)
    return errors


def layout_problems(page: Any) -> list[str]:
    return list(page.evaluate(LAYOUT_PROBE_JS))


def sidebar_problems(page: Any) -> list[str]:
    return list(page.evaluate(SIDEBAR_PROBE_JS)["issues"])


def start_backend(port: int, data_dir: Path) -> subprocess.Popen[bytes]:
    env = {**os.environ, "PPML_DATA_DIR": str(data_dir), "PPML_PORT": str(port), "PPML_LOG_LEVEL": "WARNING"}
    cmd = [sys.executable, "-m", "uvicorn", "ppml.main:create_app", "--factory",
           "--host", "127.0.0.1", "--port", str(port), "--app-dir", "backend"]  # fmt: skip
    # Only ever starts this project's own backend: fixed argv, no shell, loopback host.
    proc = subprocess.Popen(cmd, cwd=ROOT, env=env)  # noqa: S603  # nosec B603
    base = f"http://127.0.0.1:{port}"
    for _ in range(120):
        if proc.poll() is not None:
            raise SystemExit(f"backend exited early with code {proc.returncode}")
        try:
            if get_json(base, "/api/health").get("status") == "ok":
                return proc
        except OSError:
            pass
        time.sleep(0.5)
    proc.terminate()
    raise SystemExit("backend did not become healthy within 60 s")


def capture(base: str, out: Path) -> list[str]:
    from playwright.sync_api import sync_playwright

    exps = get_json(base, "/api/experiments")

    def by(kind: str) -> str:
        return next(e["id"] for e in exps if e["type"] == kind and e["status"] == "completed")

    fed = next(e["id"] for e in exps if e["name"].startswith("Experiment C2"))
    ds = next(d for d in get_json(base, "/api/datasets") if d["source"] == "synthetic")
    store = {
        "run-dp": by("comparison"),
        "run-fed": fed,
        "run-attack": by("attack"),
        f"run-pii-{ds['id']}": by("pii"),
    }
    problems: list[str] = []
    mobile = {"is_mobile": True, "has_touch": True}

    def click(name: str) -> Any:
        return lambda page: page.get_by_role("button", name=name).click()

    reports_before = len(get_json(base, "/api/reports"))
    report_mode = reports_page_action(reports_before)

    def open_report(page: Any) -> None:
        if report_mode == "preview":
            page.get_by_role("button", name=re.compile(r"^Preview report ")).first.click()
        else:
            page.get_by_role("button", name="Generate report").click()
        page.get_by_label("Report preview").wait_for(timeout=30000)

    shots: list[tuple[str, str, dict[str, Any]]] = [
        ("01-overview", "/", {}),
        ("02-dataset-studio", "/datasets", {}),
        ("03-privacy-inspector", f"/inspector?ds={ds['id']}", {"action": click("Preview")}),
        ("04-dp-studio", "/dp", {"full": False}),
        ("05-dp-training-results", "/dp", {}),
        ("06-federated-studio", "/federated", {}),
        ("07-attack-lab", "/attacks", {}),
        ("08-experiment-comparison", "/analytics", {}),
        ("09-privacy-reports", "/reports", {"action": open_report}),
        ("10-budget-sweep", f"/experiments?id={by('budget_sweep')}", {}),
        ("11-settings", "/settings", {}),
        ("12-documentation", "/docs", {}),
        ("13-overview-light", "/", {"theme": "light", "full": False}),
        ("14-dp-light", "/dp", {"theme": "light"}),
        ("15-mobile-overview", "/", {"w": 390, "h": 844, "device": mobile}),
        ("16-mobile-attack", "/attacks", {"w": 390, "h": 844, "device": mobile}),
        ("17-tablet-federated", "/federated", {"w": 820, "h": 1180}),
        ("18-laptop-dp", "/dp", {"w": 1280, "h": 720, "full": False}),
    ]
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for name, path, o in shots:
            w, h = o.get("w", 1440), o.get("h", 900)
            viewport: ViewportSize = {"width": w, "height": h}
            ctx = browser.new_context(viewport=viewport, device_scale_factor=1, **o.get("device", {}))
            init = {"store": store, "theme": o.get("theme", "dark")}
            ctx.add_init_script(
                f"(() => {{ const c = {json.dumps(init)};"
                " for (const [k, v] of Object.entries(c.store)) sessionStorage.setItem(k, v);"
                " localStorage.setItem('privora-theme', c.theme); })();"
            )
            page = ctx.new_page()
            errors = collect_page_errors(page)
            page.goto(base + path, wait_until="networkidle")
            page.wait_for_timeout(1500)
            if "action" in o:
                o["action"](page)
                page.wait_for_timeout(1500)
            issues = settle_notifications(page)
            text = page.inner_text("body")
            title = page.title()
            scroll_w = page.evaluate("document.documentElement.scrollWidth")
            culprit = overflow_culprit(page) if scroll_w > w else ""
            file = out / f"{name}.png"
            page.screenshot(path=str(file), full_page=o.get("full", True))
            issues += layout_problems(page)
            issues += sidebar_problems(page)  # after the shot: it scrolls the menu
            ctx.close()

            issues += [f"console/page error: {e[:160]}" for e in errors]
            if scroll_w > w:
                issues.append(f"horizontal overflow: content {scroll_w}px > viewport {w}px ({culprit})")
            if PRODUCT not in title or PRODUCT not in text:
                issues.append(f"'{PRODUCT}' missing from title or visible text")
            if FORMER_NAME in (title + text).lower():
                issues.append("former product name visible on the page")
            chunks = sorted(set(png_chunk_types(file)))
            if chunks != ["IDAT", "IEND", "IHDR"]:
                issues.append(f"PNG chunks {chunks}, expected only IHDR/IDAT/IEND")
            print(f"{'OK  ' if not issues else 'FAIL'} {name:26} {w}px  chunks={chunks}", flush=True)
            problems += [f"{name}: {i}" for i in issues]
            if name.startswith("09-"):
                problems += [
                    f"{name}: {i}"
                    for i in report_count_problems(
                        reports_before, len(get_json(base, "/api/reports")), report_mode
                    )
                ]
                print(f"     reports: {reports_before} saved before, mode={report_mode}", flush=True)

        # Layout checks on views the screenshots do not cover (no screenshot).
        extra_views = [("/", 820, 1180), ("/analytics", 390, 844), ("/analytics", 820, 1180),
                       ("/attacks", 820, 1180), ("/reports", 390, 844), ("/datasets", 390, 844)]  # fmt: skip
        for path, w, h in extra_views:
            ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
            init = {"store": store, "theme": "dark"}
            ctx.add_init_script(
                f"(() => {{ const c = {json.dumps(init)};"
                " for (const [k, v] of Object.entries(c.store)) sessionStorage.setItem(k, v); })();"
            )
            page = ctx.new_page()
            view_errors = collect_page_errors(page, console=False)
            page.goto(base + path, wait_until="networkidle")
            page.wait_for_timeout(1500)
            found = layout_problems(page) + [f"page error: {e[:160]}" for e in view_errors]
            view_w = page.evaluate("document.documentElement.scrollWidth")
            if view_w > w:
                found.append(
                    f"horizontal overflow: content {view_w}px > viewport {w}px ({overflow_culprit(page)})"
                )
            ctx.close()
            print(f"{'OK  ' if not found else 'FAIL'} layout {path} {w}px", flush=True)
            problems += [f"layout {path} {w}px: {i}" for i in found]

        # Sidebar reachability at laptop height and below (no screenshot).
        for height in (720, 600, 480):
            ctx = browser.new_context(viewport={"width": 1280, "height": height}, device_scale_factor=1)
            page = ctx.new_page()
            page.goto(base + "/", wait_until="networkidle")
            page.wait_for_timeout(500)
            found = sidebar_problems(page)
            ctx.close()
            print(f"{'OK  ' if not found else 'FAIL'} sidebar 1280x{height}", flush=True)
            problems += [f"sidebar 1280x{height}: {i}" for i in found]
        browser.close()
    problems += [
        f"whole run: {i}"
        for i in report_count_problems(reports_before, len(get_json(base, "/api/reports")), report_mode)
    ]
    return problems


def main() -> int:
    rx.configure_console()  # piped output on Windows uses cp1252; experiment names contain non-ASCII
    ap = argparse.ArgumentParser(description="Regenerate the README screenshots from an isolated instance.")
    ap.add_argument("--out", type=Path, default=ROOT / "screenshots-capture", help="output folder")
    args = ap.parse_args()
    out = args.out.resolve()
    if out == (ROOT / "assets" / "screenshots").resolve():
        print("Refusing to write directly into assets/screenshots/. Capture elsewhere, review, then copy.")
        return 2
    if not (ROOT / "frontend" / "dist" / "index.html").is_file():
        print("frontend/dist is missing. Build the UI first (setup.ps1 or `npm run build` in frontend/).")
        return 2
    try:
        import playwright  # noqa: F401
    except ImportError:
        print("Playwright is not installed. See the instructions at the top of this script.")
        return 2
    out.mkdir(parents=True, exist_ok=True)

    tmp = Path(tempfile.mkdtemp(prefix="privora-capture-"))
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    print(f"Temporary instance: {base}  data: {tmp}")
    proc = start_backend(port, tmp / "data")
    try:
        rx.BASE = base  # point the reference-experiment runner at the temporary instance
        rx.OUT = tmp / "experiments.json"  # never touch docs/results/experiments.json
        rx.main()
        problems = capture(base, out)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            proc.kill()
        for _ in range(10):
            try:
                shutil.rmtree(tmp)
                break
            except OSError:
                time.sleep(1)
        else:
            print(f"Could not delete the temporary folder {tmp}; remove it manually.")

    print(f"Screenshots written to {out}")
    if problems:
        print(f"{len(problems)} problem(s):")
        for p in problems:
            print("  -", p)
        return 1
    print("All 18 screenshots passed every check. Review them, then copy them into assets/screenshots/.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
