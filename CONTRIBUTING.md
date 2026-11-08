# Contributing

Thanks for your interest in Umbra.

## Development setup

```powershell
.\setup.ps1
.\run.ps1 -Dev        # backend :8000 + Vite :5173 with hot reload
```

## Before opening a pull request

```powershell
.\verify.ps1          # must finish with "Failed: 0"
```

That runs Ruff (lint + format), mypy, Bandit, pip-audit, the pytest suite, the smoke tests,
the TypeScript check, Vitest and the production build.

## Guidelines

* **Privacy claims must be backed by code.** Any ε shown to users must come from an accountant
  call, never a constant. Document new assumptions in `docs/PRIVACY_METHODOLOGY.md`.
* **No arbitrary pickling.** Persist models as `state_dict` + JSON; load with `weights_only=True`.
* **No real personal data** in tests, fixtures or examples. Use `ppml.core.data.synthetic`.
* Add tests for new behaviour; do not weaken or skip existing ones.
* Python: type hints on all functions, docstrings on public functions, Ruff-clean.
* Frontend: TypeScript strict, components in `src/components`, colours only via design tokens
  in `src/index.css` so both themes keep working.
* Keep commits focused; describe *why* in the message.
