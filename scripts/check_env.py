"""Import the core dependencies and report their versions and CUDA availability.

Used by verify.ps1. Kept as a file (rather than ``python -c "..."``) because Windows
PowerShell 5.1 strips embedded double quotes from native-command arguments, which turned
string literals in an inline snippet into bare names (``NameError: name 'cuda' is not defined``).
"""

from __future__ import annotations

import importlib
import sys

MODULES = ["torch", "opacus", "sklearn", "fastapi", "pandas", "numpy"]


def main() -> int:
    versions: list[str] = []
    for name in MODULES:
        try:
            mod = importlib.import_module(name)
        except ImportError as exc:
            print(f"cannot import {name}: {exc}")
            return 1
        versions.append(f"{name} {getattr(mod, '__version__', '?')}")
    import torch

    print(", ".join(versions) + f" | cuda_available={torch.cuda.is_available()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
