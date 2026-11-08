"""Tabular neural-network models.

The MLP uses only layers supported by Opacus per-sample gradient computation (``Linear``,
``ReLU``/``Tanh``, ``Dropout``). BatchNorm is intentionally absent because it mixes
information across samples in a batch and is incompatible with DP-SGD.
"""

from __future__ import annotations

import torch
from torch import nn


class TabularMLP(nn.Module):
    """A configurable multi-layer perceptron for tabular classification."""

    def __init__(
        self,
        n_features: int,
        n_classes: int,
        hidden: tuple[int, ...] = (64, 32),
        dropout: float = 0.0,
        activation: str = "relu",
    ) -> None:
        super().__init__()
        if n_features < 1 or n_classes < 2:
            raise ValueError("n_features must be >= 1 and n_classes >= 2")
        act: type[nn.Module] = nn.Tanh if activation == "tanh" else nn.ReLU
        layers: list[nn.Module] = []
        prev = n_features
        for h in hidden:
            layers += [nn.Linear(prev, h), act()]
            if dropout > 0:
                layers.append(nn.Dropout(dropout))
            prev = h
        layers.append(nn.Linear(prev, n_classes))
        self.net = nn.Sequential(*layers)
        self.config = {
            "n_features": n_features,
            "n_classes": n_classes,
            "hidden": list(hidden),
            "dropout": dropout,
            "activation": activation,
        }

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def build_model(
    n_features: int,
    n_classes: int,
    hidden: list[int] | tuple[int, ...],
    dropout: float = 0.0,
    activation: str = "relu",
) -> TabularMLP:
    return TabularMLP(n_features, n_classes, tuple(hidden), dropout, activation)


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


def resolve_device(pref: str = "auto") -> torch.device:
    if pref != "cpu" and torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")
