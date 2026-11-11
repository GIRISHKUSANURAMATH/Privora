"""Regressions for the screenshot inspection (screenshots 08, 09, 15, 16 and 18).

* 09 / 15: the capture clicked "Generate report" although scripts/run_experiments.py had already
  written one per experiment, so every run added a duplicate report and its success toast was in
  the shot. The capture now previews an existing report and checks the report count.
* The browser probes in scripts/capture_screenshots.py must catch each defect class that reached
  the published screenshots: a card sticking out of its panel (15), chart labels running into each
  other (08, 16), axis labels that do not match their positions (07, 16), a sidebar item hidden
  behind the footer (18) and a notification still on screen (09). The probe tests run each check
  against a page that has the defect and one that does not; they need Playwright and Chromium and
  are skipped when those are not installed.
"""

from __future__ import annotations

import ast
import sys
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import capture_screenshots as cs  # noqa: E402


# ------------------------------------------------------------------ duplicate reports
def test_existing_report_is_previewed_not_regenerated() -> None:
    assert cs.reports_page_action(0) == "generate"
    assert cs.reports_page_action(1) == "preview"
    assert cs.reports_page_action(7) == "preview"


def test_report_count_check_flags_a_duplicate() -> None:
    assert cs.report_count_problems(7, 7, "preview") == []
    assert cs.report_count_problems(0, 1, "generate") == []
    assert cs.report_count_problems(7, 8, "preview") != []  # the original defect
    assert cs.report_count_problems(0, 0, "generate") != []  # a failed generation is not hidden


def test_reports_shot_does_not_click_generate_unconditionally() -> None:
    tree = ast.parse((ROOT / "scripts" / "capture_screenshots.py").read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "click":
            assert not (
                node.args
                and isinstance(node.args[0], ast.Constant)
                and node.args[0].value == "Generate report"
            )


def test_reference_runner_still_writes_reports() -> None:
    """The capture relies on run_experiments.py having written reports; keep that contract visible."""
    assert "/api/reports/" in (ROOT / "scripts" / "run_experiments.py").read_text(encoding="utf-8")


@pytest.mark.parametrize("target", ["win32", "linux"])
def test_capture_script_type_checks(target: str) -> None:
    """mypy reported 4 errors in this script: untyped viewport dict, and two-argument lambdas
    (``lambda e, errors=errors: ...``) passed where Playwright expects one-argument handlers."""
    api = pytest.importorskip("mypy.api")
    stdout, stderr, status = api.run(
        [
            "--config-file",
            str(ROOT / "mypy.ini"),
            "--platform",
            target,
            str(ROOT / "scripts" / "capture_screenshots.py"),
        ]
    )
    assert status == 0, stdout + stderr


# ------------------------------------------------------------------ browser probes
@pytest.fixture(scope="module")
def browser() -> Iterator[Any]:
    sync_api = pytest.importorskip("playwright.sync_api")
    with sync_api.sync_playwright() as pw:
        try:
            b = pw.chromium.launch()
        except sync_api.Error as exc:  # browser not downloaded
            pytest.skip(f"Chromium is not available: {exc}")
        yield b
        b.close()


def _page(browser: Any, html: str, height: int = 800) -> Any:
    ctx = browser.new_context(viewport={"width": 600, "height": height})
    page = ctx.new_page()
    page.set_content(f"<!doctype html><html><body style='margin:0;font:14px sans-serif'>{html}</body></html>")
    return page


GRID = (
    "<div id='main'><div style='width:300px;padding:10px'><div style='display:grid;{cols}gap:12px'>"
    "<div style='border:1px solid'>"
    "<span style='display:inline-block;width:330px;max-width:100%'>Start something</span></div>"
    "</div></div></div>"
)


def test_probe_detects_a_card_sticking_out_of_its_panel(browser: Any) -> None:
    broken = cs.layout_problems(_page(browser, GRID.format(cols="")))
    assert any("sticks out" in i for i in broken), broken
    assert cs.layout_problems(_page(browser, GRID.format(cols="grid-template-columns:minmax(0,1fr);"))) == []


def _labels(x2: int) -> str:
    return (
        "<div class='recharts-wrapper'><svg width='400' height='60'>"
        "<text x='10' y='30' font-size='11'>Entropy threshold</text>"
        f"<text x='{x2}' y='30' font-size='11'>Shadow models</text>"
        "</svg></div>"
    )


def test_probe_detects_overlapping_chart_labels(browser: Any) -> None:
    assert any("overlap" in i for i in cs.layout_problems(_page(browser, _labels(60))))
    assert cs.layout_problems(_page(browser, _labels(250))) == []


def test_probe_detects_a_label_cut_off_at_the_chart_edge(browser: Any) -> None:
    # Regression: the Data quality axis printed "100000000%", clipped at the left edge.
    html = (
        "<div class='recharts-wrapper'><svg class='recharts-surface' width='300' height='60'>"
        "<text x='{x}' y='30' text-anchor='end'>100000000%</text></svg></div>"
    )
    assert any("cut off" in i for i in cs.layout_problems(_page(browser, html.format(x=20))))
    assert cs.layout_problems(_page(browser, html.format(x=200))) == []


def test_probe_detects_a_point_covering_a_label(browser: Any) -> None:
    html = (
        "<div class='recharts-wrapper'><svg width='400' height='60'><text x='10' y='30'>Non-private</text>"
        "<circle class='recharts-scatter-symbol' cx='{cx}' cy='26' r='5'/></svg></div>"
    )
    assert any("covers the label" in i for i in cs.layout_problems(_page(browser, html.format(cx=30))))
    assert cs.layout_problems(_page(browser, html.format(cx=300))) == []


def _axis(labels: list[str], positions: Sequence[float]) -> str:
    ticks = "".join(
        f"<g class='recharts-cartesian-axis-tick'><text x='{x}' y='20' text-anchor='middle'>{lab}</text></g>"
        for lab, x in zip(labels, positions, strict=True)
    )
    axis = f"<g class='recharts-cartesian-axis recharts-xAxis'>{ticks}</g>"
    return f"<div class='recharts-wrapper'><svg width='600' height='40'>{axis}</svg></div>"


def test_probe_detects_axis_labels_that_do_not_match_positions(browser: Any) -> None:
    pos = [40, 160, 280, 400, 520]  # Recharts' 0, 0.25, 0.5, 0.75, 1 ticks
    broken = cs.layout_problems(_page(browser, _axis(["0.0", "0.3", "0.5", "0.8", "1.0"], pos)))
    assert any("do not match their positions" in i for i in broken), broken
    assert cs.layout_problems(_page(browser, _axis(["0", "0.25", "0.5", "0.75", "1"], pos))) == []
    assert cs.layout_problems(_page(browser, _axis(["60%", "65%", "70%", "75%", "80%"], pos))) == []
    # A log axis (privacy budget) is accepted when spacing follows log10.
    assert cs.layout_problems(_page(browser, _axis(["1", "10", "100"], [40, 280, 520]))) == []


SIDEBAR = (
    "<aside style='position:fixed;inset:0 auto 0 0;width:250px;display:flex;flex-direction:column'>"
    "<div style='height:64px;flex-shrink:0'>brand</div>"
    "<nav style='flex:1;{nav}'>{links}</nav>"
    "<div style='flex-shrink:0;height:60px;{footer}background:#ddd'><button>Collapse</button></div></aside>"
)
LINKS = "".join(f"<a href='#' style='display:flex;height:36px'>Item {i}</a>" for i in range(14))


def test_probe_detects_a_sidebar_item_hidden_behind_the_footer(browser: Any) -> None:
    broken = SIDEBAR.format(
        nav="min-height:0;overflow:visible", footer="position:relative;z-index:1;", links=LINKS
    )
    found = cs.sidebar_problems(_page(browser, broken, height=500))
    assert any("Item 13" in i for i in found), found
    fixed = SIDEBAR.format(nav="min-height:0;overflow-y:auto", footer="", links=LINKS)
    assert cs.sidebar_problems(_page(browser, fixed, height=500)) == []
    # At 720 px or taller the menu must fit without scrolling.
    assert any(
        "needs scrolling" in i
        for i in cs.sidebar_problems(_page(browser, fixed.replace("36px", "60px"), height=720))
    )


def test_notifications_must_clear_and_errors_are_reported(browser: Any) -> None:
    ok = (
        "<div data-toasts><div role='status' id='t'>Report generated</div></div>"
        "<script>setTimeout(() => document.getElementById('t').remove(), 600)</script>"
    )
    assert cs.settle_notifications(_page(browser, ok), timeout_ms=5000) == []
    err = "<div data-toasts><div role='alert'>Couldn't generate the report</div></div>"
    found = cs.settle_notifications(_page(browser, err), timeout_ms=800)
    assert any("error notification: Couldn't generate the report" in i for i in found)
    assert any("still on screen" in i for i in found)


def test_page_error_collector_records_console_and_page_errors(browser: Any) -> None:
    html = "<script>console.error('boom in console'); console.log('not an error')</script>"
    page = browser.new_context().new_page()
    errors = cs.collect_page_errors(page)
    page.set_content(html)
    page.evaluate("() => setTimeout(() => { throw new Error('uncaught boom'); }, 0)")
    page.wait_for_timeout(300)
    assert any("boom in console" in e for e in errors)
    assert any("uncaught boom" in e for e in errors)
    assert not any("not an error" in e for e in errors)

    page2 = browser.new_context().new_page()
    only_page = cs.collect_page_errors(page2, console=False)
    page2.set_content(html)
    page2.evaluate("() => setTimeout(() => { throw new Error('uncaught boom'); }, 0)")
    page2.wait_for_timeout(300)
    assert only_page and all("boom in console" not in e for e in only_page)
