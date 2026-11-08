"""Safe model persistence.

Weights are stored with ``torch.save`` of a plain ``state_dict`` and always reloaded with
``torch.load(..., weights_only=True)``, which refuses to unpickle arbitrary objects.
Model architecture and encoder state are stored as JSON. No ``pickle``/``joblib`` is used.
Artifact paths are derived from server-generated IDs only, never from user input.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import torch
from torch import nn

from ppml.core.data.preprocessing import TabularEncoder
from ppml.core.ml.models import TabularMLP

_ID = re.compile(r"^[a-f0-9]{8,64}$")


def _strip_dp_prefix(state: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    """Opacus wraps modules in GradSampleModule which prefixes keys with ``_module.``."""
    return {k.removeprefix("_module."): v for k, v in state.items()}


def safe_artifact_dir(root: Path, artifact_id: str) -> Path:
    if not _ID.match(artifact_id):
        raise ValueError("Invalid artifact id")
    path = (root / artifact_id).resolve()
    if root.resolve() not in path.parents:
        raise ValueError("Artifact path escapes artifact root")
    return path


def save_model(
    root: Path, artifact_id: str, model: nn.Module, encoder: TabularEncoder, meta: dict[str, Any]
) -> Path:
    d = safe_artifact_dir(root, artifact_id)
    d.mkdir(parents=True, exist_ok=True)
    inner = getattr(model, "_module", model)
    config = getattr(inner, "config", None)
    if config is None:
        raise ValueError("Model has no serialisable config")
    torch.save(_strip_dp_prefix(model.state_dict()), d / "weights.pt")
    (d / "model.json").write_text(json.dumps({"architecture": config, "meta": meta}, indent=2))
    (d / "encoder.json").write_text(json.dumps(encoder.to_dict(), indent=2))
    return d


def load_model(root: Path, artifact_id: str) -> tuple[TabularMLP, TabularEncoder, dict[str, Any]]:
    d = safe_artifact_dir(root, artifact_id)
    spec = json.loads((d / "model.json").read_text())
    arch = spec["architecture"]
    model = TabularMLP(
        arch["n_features"],
        arch["n_classes"],
        tuple(arch["hidden"]),
        arch.get("dropout", 0.0),
        arch.get("activation", "relu"),
    )
    state = torch.load(d / "weights.pt", map_location="cpu", weights_only=True)
    model.load_state_dict(state)
    model.eval()
    encoder = TabularEncoder.from_dict(json.loads((d / "encoder.json").read_text()))
    return model, encoder, spec.get("meta", {})
