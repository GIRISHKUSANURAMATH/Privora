"""Validated experiment configurations."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from ppml.core.data.transforms import ColumnRule

ExperimentType = Literal["baseline", "dp", "comparison", "budget_sweep", "federated", "attack", "pii"]


class ModelParams(BaseModel):
    hidden: list[int] = Field(default=[64, 32], min_length=1, max_length=5)
    dropout: float = Field(default=0.0, ge=0, le=0.8)
    activation: Literal["relu", "tanh"] = "relu"
    epochs: int = Field(default=15, ge=1, le=300)
    batch_size: int = Field(default=64, ge=4, le=4096)
    lr: float = Field(default=1e-3, gt=0, le=5)
    optimizer: Literal["adam", "sgd"] = "adam"
    weight_decay: float = Field(default=0.0, ge=0, le=1)
    seed: int = Field(default=42, ge=0, le=2**31 - 1)

    @field_validator("hidden")
    @classmethod
    def _hidden_ok(cls, v: list[int]) -> list[int]:
        if any(h < 2 or h > 1024 for h in v):
            raise ValueError("hidden layer sizes must be in [2, 1024]")
        return v


class DataParams(BaseModel):
    dataset_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    target: str = Field(min_length=1, max_length=64)
    exclude: list[str] = Field(default_factory=list, max_length=200)
    auto_exclude_pii: bool = True
    test_size: float = Field(default=0.3, ge=0.1, le=0.5)
    max_train_rows: int | None = Field(default=None, ge=50, le=200_000)


class DPParams(BaseModel):
    target_epsilon: float | None = Field(default=3.0, ge=0.01, le=100)
    noise_multiplier: float | None = Field(default=None, ge=0.05, le=50)
    delta: float = Field(default=1e-5, gt=0, lt=1)
    max_grad_norm: float = Field(default=1.0, gt=0, le=100)
    accountant: Literal["rdp", "prv"] = "rdp"

    @model_validator(mode="after")
    def _one_of(self) -> DPParams:
        if (self.target_epsilon is None) == (self.noise_multiplier is None):
            raise ValueError("Set exactly one of target_epsilon or noise_multiplier")
        return self


class FedParams(BaseModel):
    num_clients: int = Field(default=8, ge=2, le=100)
    rounds: int = Field(default=15, ge=1, le=300)
    client_fraction: float = Field(default=0.5, gt=0, le=1)
    local_epochs: int = Field(default=2, ge=1, le=50)
    batch_size: int = Field(default=32, ge=4, le=4096)
    lr: float = Field(default=0.05, gt=0, le=5)
    partition: Literal["iid", "dirichlet"] = "iid"
    dirichlet_alpha: float = Field(default=0.5, gt=0, le=100)
    privacy: Literal["none", "client_dp", "local_dp_sgd"] = "none"
    clip_norm: float = Field(default=1.0, gt=0, le=100)
    noise_multiplier: float = Field(default=1.0, gt=0, le=50)
    delta: float = Field(default=1e-5, gt=0, lt=1)
    local_max_grad_norm: float = Field(default=1.0, gt=0, le=100)


class AttackParams(BaseModel):
    epsilons: list[float] = Field(default=[1.0, 8.0], max_length=6)
    shadow_models: int = Field(default=3, ge=0, le=8)
    max_eval: int = Field(default=1000, ge=100, le=10_000)
    attribute: str | None = Field(default=None, max_length=64)
    delta: float = Field(default=1e-5, gt=0, lt=1)
    max_grad_norm: float = Field(default=1.0, gt=0, le=100)

    @field_validator("epsilons")
    @classmethod
    def _eps_ok(cls, v: list[float]) -> list[float]:
        if any(e <= 0 or e > 100 for e in v):
            raise ValueError("epsilons must be in (0, 100]")
        return sorted(v)


class SweepParams(BaseModel):
    epsilons: list[float] = Field(default=[0.5, 1.0, 2.0, 4.0, 8.0], min_length=1, max_length=10)
    delta: float = Field(default=1e-5, gt=0, lt=1)
    max_grad_norm: float = Field(default=1.0, gt=0, le=100)
    accountant: Literal["rdp", "prv"] = "rdp"

    @field_validator("epsilons")
    @classmethod
    def _eps_ok(cls, v: list[float]) -> list[float]:
        if any(e < 0.05 or e > 100 for e in v):
            raise ValueError("epsilons must be in [0.05, 100]")
        return sorted(set(v))


class PIIParams(BaseModel):
    dataset_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    target: str | None = Field(default=None, max_length=64)
    rules: list[ColumnRule] | None = Field(default=None, max_length=200)
    measure_utility: bool = True


class ExperimentRequest(BaseModel):
    type: ExperimentType
    name: str | None = Field(default=None, max_length=120)
    data: DataParams | None = None
    model: ModelParams = Field(default_factory=ModelParams)
    dp: DPParams | None = None
    federated: FedParams | None = None
    attack: AttackParams | None = None
    sweep: SweepParams | None = None
    pii: PIIParams | None = None

    @model_validator(mode="after")
    def _sections(self) -> ExperimentRequest:
        needs_data = self.type != "pii"
        if needs_data and self.data is None:
            raise ValueError("'data' section is required")
        if self.type in ("dp", "comparison") and self.dp is None:
            self.dp = DPParams()
        if self.type == "federated" and self.federated is None:
            self.federated = FedParams()
        if self.type == "attack" and self.attack is None:
            self.attack = AttackParams()
        if self.type == "budget_sweep" and self.sweep is None:
            self.sweep = SweepParams()
        if self.type == "pii" and self.pii is None:
            raise ValueError("'pii' section is required")
        return self
