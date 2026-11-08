"""Shared application state and FastAPI dependencies."""

from __future__ import annotations

from dataclasses import dataclass

import torch
from fastapi import HTTPException, Request

from ppml.config import Settings
from ppml.core.data.store import DatasetStore
from ppml.core.experiments.runner import ExperimentRunner
from ppml.db import Database


@dataclass
class AppState:
    settings: Settings
    db: Database
    store: DatasetStore
    runner: ExperimentRunner
    device: torch.device


def get_state(request: Request) -> AppState:
    state: AppState = request.app.state.ppml
    return state


def not_found(what: str = "Resource") -> HTTPException:
    return HTTPException(status_code=404, detail=f"{what} not found")
