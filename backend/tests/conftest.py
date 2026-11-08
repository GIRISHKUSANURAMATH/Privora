"""Shared fixtures. Every test gets an isolated data directory."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from ppml.config import Settings
from ppml.core.data.synthetic import generate_patients
from ppml.main import create_app


@pytest.fixture()
def settings(tmp_path: Path) -> Settings:
    s = Settings(
        data_dir=tmp_path / "data",
        max_upload_mb=2,
        log_level="WARNING",
        allowed_hosts=["testserver", "127.0.0.1", "localhost"],
    )
    s.ensure_dirs()
    return s


@pytest.fixture()
def client(settings: Settings) -> Iterator[TestClient]:
    app = create_app(settings, serve_frontend=False)
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def patients() -> pd.DataFrame:
    return generate_patients(1200, seed=3)
