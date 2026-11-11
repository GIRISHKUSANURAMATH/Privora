"""Application configuration loaded from environment variables (prefix ``PPML_``)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Runtime settings. Every field can be overridden with ``PPML_<FIELD>``."""

    model_config = SettingsConfigDict(env_prefix="PPML_", env_file=PROJECT_ROOT / ".env", extra="ignore")

    data_dir: Path = Field(default=PROJECT_ROOT / "data")
    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    # Host headers the API answers to (DNS-rebinding protection). Add a name here only if you
    # deliberately serve Privora under another hostname.
    allowed_hosts: list[str] = ["127.0.0.1", "localhost", "[::1]"]
    max_upload_mb: int = Field(default=20, ge=1, le=500)
    max_rows: int = Field(default=200_000, ge=100)
    max_columns: int = Field(default=200, ge=2)
    max_concurrent_jobs: int = Field(default=1, ge=1, le=8)
    log_level: str = "INFO"
    torch_threads: int = Field(default=0, ge=0, description="0 = PyTorch default")
    device: str = Field(default="auto", pattern="^(auto|cpu|cuda)$")

    @property
    def datasets_dir(self) -> Path:
        return self.data_dir / "datasets"

    @property
    def artifacts_dir(self) -> Path:
        return self.data_dir / "artifacts"

    @property
    def reports_dir(self) -> Path:
        return self.data_dir / "reports"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "ppml.sqlite3"

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    def ensure_dirs(self) -> None:
        for d in (self.data_dir, self.datasets_dir, self.artifacts_dir, self.reports_dir):
            d.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the cached settings singleton."""
    s = Settings()
    s.ensure_dirs()
    return s
