"""Experiment reports in Markdown, standalone HTML and JSON — built only from stored results."""

from __future__ import annotations

import copy
import html
import json
from typing import Any

from ppml import __version__


def _f(v: Any, digits: int = 4) -> str:
    if v is None:
        return "—"
    if isinstance(v, float):
        return f"{v:.{digits}f}"
    return str(v)


def _model_table(models: list[dict[str, Any]]) -> list[str]:
    lines = [
        "| Model | Accuracy | Precision | Recall | F1 | ROC-AUC | ε | δ | Train time (s) |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for m in models:
        t = m.get("test", {})
        pv = m.get("privacy") or {}
        lines.append(
            f"| {m['label']} | {_f(t.get('accuracy'))} | {_f(t.get('precision'))} | "
            f"{_f(t.get('recall'))} | {_f(t.get('f1'))} | {_f(t.get('roc_auc'))} | "
            f"{_f(pv.get('epsilon'), 3)} | {_f(pv.get('delta'), 7) if pv else '—'} | "
            f"{_f(m.get('train_seconds'), 2)} |"
        )
    return lines


def to_markdown(exp: dict[str, Any], dataset: dict[str, Any] | None) -> str:
    r = exp.get("results") or {}
    L: list[str] = [
        f"# {exp['name']}",
        "",
        f"- **Experiment ID:** `{exp['id']}`",
        f"- **Type:** {exp['type']}",
        f"- **Status:** {exp['status']}",
        f"- **Created:** {exp['created_at']}  ·  **Finished:** {exp.get('finished_at') or '—'}",
        f"- **Duration:** {_f(exp.get('duration_s'), 2)} s",
        f"- **Dataset:** {dataset['name'] if dataset else '—'} "
        f"({dataset['rows'] if dataset else '?'} rows, source: {dataset['source'] if dataset else '?'})",
        f"- **Framework version:** {__version__}",
        "",
        "> All numbers below were produced by this run and read from the experiment store. "
        "Nothing is hard-coded.",
        "",
    ]
    data = r.get("data")
    if data:
        L += [
            "## Data",
            "",
            f"- Train rows: {data['n_train']} · Test rows: {data['n_test']} · "
            f"Encoded features: {data['n_features']}",
            f"- Features used: {', '.join(data['features_used'])}",
            f"- Excluded (identifiers / user exclusions): {', '.join(data['excluded']) or 'none'}",
            "",
        ]
    models = r.get("models") or []
    if models and exp["type"] != "pii":
        L += ["## Model performance (held-out test set)", "", *_model_table(models), ""]
    for m in models:
        pv = m.get("privacy")
        if pv and "accountant" in pv:
            L += [
                f"### Privacy accounting — {m['label']}",
                "",
                f"- Guarantee: {pv['guarantee']}",
                f"- ε = {_f(pv['epsilon'], 4)} at δ = {pv['delta']:g} "
                f"(accountant: {pv['accountant_info']['name']})",
                f"- Noise multiplier σ = {_f(pv['noise_multiplier'], 4)}, clipping norm "
                f"C = {pv['max_grad_norm']}, noise std = {_f(pv['noise_std'], 4)}",
                f"- Sampling: {pv['sampling']}, rate q = {_f(pv['sample_rate'], 5)}, "
                f"steps = {pv['steps']}, epochs = {pv['epochs']}",
                "- Assumptions:",
                *[f"  - {a}" for a in pv["assumptions"]],
                "",
            ]
    if r.get("curve"):
        L += [
            "## Privacy–utility curve",
            "",
            "| Target ε | Achieved ε | σ | Accuracy | F1 |",
            "|---|---|---|---|---|",
        ]
        for c in r["curve"]:
            L.append(
                f"| {c['target_epsilon']:g} | {_f(c['epsilon'], 3)} | "
                f"{_f(c['noise_multiplier'], 3)} | {_f(c['accuracy'])} | {_f(c['f1'])} |"
            )
        L += ["", f"Conventional reference accuracy: {_f(r['baseline_accuracy'])}", ""]
    fed = r.get("federated")
    if fed:
        pv = fed["privacy"]
        L += [
            "## Federated learning",
            "",
            f"- Clients: {len(fed['clients'])} · Rounds: {len(fed['rounds'])} · "
            f"Client updates: {fed['communication']['client_updates']}",
            f"- Final global accuracy: {_f(fed['final']['accuracy'])} · F1: {_f(fed['final']['f1'])}",
            f"- Privacy: {pv['guarantee']}"
            + (
                f" · ε = {_f(pv['epsilon'], 3)}, δ = {pv['delta']:g}" if pv.get("epsilon") is not None else ""
            ),
            f"- Communication: {fed['communication']['total_upload_bytes'] / 1e6:.2f} MB up, "
            f"{fed['communication']['total_download_bytes'] / 1e6:.2f} MB down",
            "",
            "| Round | Participants | Global accuracy | ε |",
            "|---|---|---|---|",
        ]
        for rr in fed["rounds"]:
            L.append(
                f"| {rr['round']} | {len(rr['participants'])} | {_f(rr['global_accuracy'])} | "
                f"{_f(rr['epsilon'], 3)} |"
            )
        L.append("")
    if exp["type"] == "attack":
        L += [
            "## Membership inference",
            "",
            r["setup"]["threat_model"],
            "",
            "| Target | Attack | AUC | Accuracy | Precision | Recall | Advantage | TPR@1%FPR "
            "| Attack-implied ε (heuristic) |",
            "|---|---|---|---|---|---|---|---|---|",
        ]
        for m in models:
            for name, a in m["attack"]["attacks"].items():
                L.append(
                    f"| {m['label']} | {name} | {_f(a['roc_auc'])} | {_f(a['accuracy'])} | "
                    f"{_f(a['precision'])} | {_f(a['recall'])} | {_f(a['advantage'])} | "
                    f"{_f(a['tpr_at_1pct_fpr'])} | {_f(a['attack_implied_epsilon'], 3)} |"
                )
        L += [
            "",
            "### Leakage indicators",
            "",
            "| Target | Train acc | Test acc | Gap | Confidence gap | Level |",
            "|---|---|---|---|---|---|",
        ]
        for m in models:
            lk = m["leakage"]
            L.append(
                f"| {m['label']} | {_f(lk['train_accuracy'])} | {_f(lk['test_accuracy'])} | "
                f"{_f(lk['generalization_gap'])} | {_f(lk['confidence_gap'])} | "
                f"{lk['leakage_level']} |"
            )
        L.append("")
        if any("attribute_inference" in m for m in models):
            L += [
                "### Attribute inference",
                "",
                "| Target | Attribute | Members acc | Non-members acc | Baseline |",
                "|---|---|---|---|---|",
            ]
            for m in models:
                ai = m.get("attribute_inference")
                if ai:
                    L.append(
                        f"| {m['label']} | {ai['attribute']} | {_f(ai['members']['accuracy'])} | "
                        f"{_f(ai['non_members']['accuracy'])} | {_f(ai['members']['baseline'])} |"
                    )
            L.append("")
        L += [
            "Limitations: results depend on the attacker model, sample sizes and seeds. A low "
            "attack score is not proof of privacy. The attack-implied ε is a heuristic from a single "
            "training run, not a statistically valid DP audit, and never an upper bound.",
            "",
        ]
    if exp["type"] == "pii":
        sb, sa = r["scan_before"]["summary"], r["scan_after"]["summary"]
        kb, ka = r["transform"]["k_anonymity_before"], r["transform"]["k_anonymity_after"]
        L += [
            "## PII protection",
            "",
            f"- Direct identifiers before: {', '.join(sb['direct_identifiers']) or 'none'}",
            f"- Direct identifiers after: {', '.join(sa['direct_identifiers']) or 'none'}",
            f"- Risk score: {sb['risk_score']} ({sb['risk_level']}) → {sa['risk_score']} "
            f"({sa['risk_level']})",
            f"- k-anonymity over {', '.join(kb['quasi_identifiers']) or '—'}: k = {kb['k']} → "
            f"{ka['k']}; unique records {kb['unique_pct']}% → {ka['unique_pct']}%",
            "",
            "| Column | Action | Changed % |",
            "|---|---|---|",
        ]
        for a in r["transform"]["applied"]:
            L.append(f"| {a['column']} | {a['action']} | {a['changed_pct']} |")
        if r.get("utility"):
            u = r["utility"]
            L += [
                "",
                f"Utility: accuracy {_f(u['original']['test']['accuracy'])} on original → "
                f"{_f(u['protected']['test']['accuracy'])} on protected data "
                f"(Δ = {_f(u['accuracy_change'])}).",
            ]
        L += ["", "Masking and generalisation reduce exposure but do not guarantee anonymity.", ""]
    if exp.get("error"):
        L += ["## Error", "", f"```\n{exp['error']}\n```", ""]
    return "\n".join(L)


_CSS = """
body{font-family:Inter,system-ui,sans-serif;background:#0b0f19;color:#e5e7eb;max-width:1000px;
margin:40px auto;padding:0 20px;line-height:1.6}h1,h2,h3{color:#fff}h1{border-bottom:1px solid #334155;
padding-bottom:8px}table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}
th,td{border:1px solid #334155;padding:6px 10px;text-align:left}th{background:#111827}
code{background:#1f2937;padding:2px 5px;border-radius:4px}blockquote{border-left:3px solid #6366f1;
margin:0;padding:4px 14px;color:#a5b4fc}
@media print{body{background:#fff;color:#111}h1,h2,h3{color:#111}th{background:#eee}}
"""


def markdown_to_html(md: str, title: str) -> str:
    """Minimal, escaping Markdown→HTML conversion for the report subset we emit."""
    out: list[str] = []
    in_table = in_list = in_code = False
    for raw in md.splitlines():
        line = raw.rstrip()
        if line.startswith("```"):
            out.append("</pre>" if in_code else "<pre>")
            in_code = not in_code
            continue
        if in_code:
            out.append(html.escape(line))
            continue
        if line.startswith("|"):
            cells = [c.strip() for c in line.strip("|").split("|")]
            if all(set(c) <= {"-"} for c in cells):
                continue
            if not in_table:
                out.append("<table><tr>" + "".join(f"<th>{_inline(c)}</th>" for c in cells) + "</tr>")
                in_table = True
            else:
                out.append("<tr>" + "".join(f"<td>{_inline(c)}</td>" for c in cells) + "</tr>")
            continue
        if in_table:
            out.append("</table>")
            in_table = False
        if line.lstrip().startswith("- "):
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append(f"<li>{_inline(line.lstrip()[2:])}</li>")
            continue
        if in_list:
            out.append("</ul>")
            in_list = False
        if line.startswith("### "):
            out.append(f"<h3>{_inline(line[4:])}</h3>")
        elif line.startswith("## "):
            out.append(f"<h2>{_inline(line[3:])}</h2>")
        elif line.startswith("# "):
            out.append(f"<h1>{_inline(line[2:])}</h1>")
        elif line.startswith("> "):
            out.append(f"<blockquote>{_inline(line[2:])}</blockquote>")
        elif line:
            out.append(f"<p>{_inline(line)}</p>")
    if in_table:
        out.append("</table>")
    if in_list:
        out.append("</ul>")
    return (
        f"<!doctype html><html lang='en'><head><meta charset='utf-8'><title>{html.escape(title)}"
        f"</title><style>{_CSS}</style></head><body>{''.join(out)}</body></html>"
    )


def _inline(s: str) -> str:
    import re

    s = html.escape(s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    return re.sub(r"`(.+?)`", r"<code>\1</code>", s)


REDACTED_SAMPLE_NOTE = (
    "Removed from exported reports: these rows contain original, unprotected values. "
    "They remain visible only inside the local application."
)


def redact_for_export(exp: dict[str, Any]) -> dict[str, Any]:
    """Copy of an experiment record that is safe to share.

    PII-protection runs store a few original rows (``transform.sample_before``) so the local UI
    can show a before/after comparison. Those rows hold the very values the run was meant to
    protect, so every export path drops them.
    """
    out = copy.deepcopy(exp)
    transform = (out.get("results") or {}).get("transform")
    if isinstance(transform, dict) and "sample_before" in transform:
        transform["sample_before"] = REDACTED_SAMPLE_NOTE
    return out


def to_json(exp: dict[str, Any], dataset: dict[str, Any] | None) -> str:
    return json.dumps(
        {"framework_version": __version__, "experiment": redact_for_export(exp), "dataset": dataset},
        indent=2,
        default=str,
    )
