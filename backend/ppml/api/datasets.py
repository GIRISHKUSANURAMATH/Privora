"""Dataset endpoints: upload, synthetic generation, profiling, PII scan, transforms, export."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ppml.api.deps import AppState, get_state, not_found
from ppml.core.data import synthetic
from ppml.core.data.loader import (
    DatasetValidationError,
    ValidationLimits,
    parse_tabular,
    preview_records,
    profile,
    sanitize_filename,
    to_safe_csv,
)
from ppml.core.data.pii import scan
from ppml.core.data.transforms import ColumnRule, apply_rules

router = APIRouter(prefix="/api/datasets", tags=["datasets"])

ID_PATTERN = r"^[a-f0-9]{32}$"


class SyntheticRequest(BaseModel):
    key: str = Field(pattern="^(patients|credit)$")
    n: int = Field(default=4000, ge=200, le=100_000)
    seed: int | None = Field(default=None, ge=0, le=2**31 - 1)


class TransformRequest(BaseModel):
    rules: list[ColumnRule] = Field(min_length=1, max_length=200)
    quasi_identifiers: list[str] | None = None
    save: bool = False
    name: str | None = Field(default=None, max_length=120)
    seed: int = Field(default=0, ge=0)


def _load(state: AppState, dataset_id: str) -> tuple[dict[str, Any], Any]:
    meta = state.store.get(dataset_id)
    if meta is None:
        raise not_found("Dataset")
    return meta, state.store.load(dataset_id)


@router.get("")
def list_datasets(state: AppState = Depends(get_state)) -> list[dict[str, Any]]:
    return state.store.list()


@router.get("/synthetic/catalog")
def synthetic_catalog() -> list[dict[str, str]]:
    return [
        {"key": s.key, "title": s.title, "description": s.description, "target": s.target}
        for s in synthetic.SPECS.values()
    ]


@router.post("/synthetic", status_code=201)
def create_synthetic(body: SyntheticRequest, state: AppState = Depends(get_state)) -> dict[str, Any]:
    spec = synthetic.SPECS[body.key]
    df = synthetic.generate(body.key, body.n, body.seed)
    return state.store.save(
        df,
        spec.title,
        "synthetic",
        spec.description,
        target_hint=spec.target,
        meta={"generator": body.key, "n": body.n, "seed": body.seed},
    )


@router.post("/upload", status_code=201)
async def upload(file: UploadFile = File(...), state: AppState = Depends(get_state)) -> dict[str, Any]:
    s = state.settings
    limit = s.max_upload_bytes
    chunks: list[bytes] = []
    size = 0
    while chunk := await file.read(1024 * 1024):
        size += len(chunk)
        if size > limit:
            raise HTTPException(413, f"File exceeds the {s.max_upload_mb} MB limit")
        chunks.append(chunk)
    name = sanitize_filename(file.filename or "dataset.csv")
    try:
        df = parse_tabular(b"".join(chunks), name, ValidationLimits(limit, s.max_rows, s.max_columns))
    except DatasetValidationError as exc:
        raise HTTPException(422, str(exc)) from exc
    target_hint = df.columns[-1]
    return state.store.save(
        df,
        name.rsplit(".", 1)[0],
        "upload",
        "Uploaded by user",
        original_filename=name,
        target_hint=target_hint,
    )


@router.get("/{dataset_id}")
def get_dataset(dataset_id: str, state: AppState = Depends(get_state)) -> dict[str, Any]:
    meta, df = _load(state, dataset_id)
    return {**meta, "profile": profile(df), "preview": preview_records(df, 25)}


@router.get("/{dataset_id}/rows")
def rows(
    dataset_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    state: AppState = Depends(get_state),
) -> dict[str, Any]:
    _, df = _load(state, dataset_id)
    page = df.iloc[offset : offset + limit]
    return {
        "total": len(df),
        "offset": offset,
        "rows": preview_records(page, limit),
        "columns": list(df.columns),
    }


@router.get("/{dataset_id}/pii")
def pii_scan(dataset_id: str, state: AppState = Depends(get_state)) -> dict[str, Any]:
    meta, df = _load(state, dataset_id)
    target = meta.get("target_hint")
    return scan(df.drop(columns=[target]) if target in df.columns else df)


@router.post("/{dataset_id}/transform")
def transform(
    dataset_id: str, body: TransformRequest, state: AppState = Depends(get_state)
) -> dict[str, Any]:
    meta, df = _load(state, dataset_id)
    qi = body.quasi_identifiers
    if qi is None:
        qi = scan(df)["summary"]["quasi_identifiers"]
    try:
        res = apply_rules(df, body.rules, qi, seed=body.seed)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    out: dict[str, Any] = {"report": res.report, "saved": None}
    if body.save:
        out["saved"] = state.store.save(
            res.data,
            body.name or f"{meta['name']} (protected)",
            "derived",
            "Privacy-transformed copy",
            target_hint=meta.get("target_hint") if meta.get("target_hint") in res.data.columns else None,
            parent_id=dataset_id,
            meta={"rules": [r.model_dump() for r in body.rules]},
        )
    return out


@router.get("/{dataset_id}/export")
def export(dataset_id: str, state: AppState = Depends(get_state)) -> Response:
    meta, df = _load(state, dataset_id)
    fname = sanitize_filename(meta["name"]).replace(" ", "_") + ".csv"
    return Response(
        to_safe_csv(df),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.delete("/{dataset_id}", status_code=204)
def delete(dataset_id: str, state: AppState = Depends(get_state)) -> Response:
    if state.store.get(dataset_id) is None:
        raise not_found("Dataset")
    state.store.delete(dataset_id)
    return Response(status_code=204)
