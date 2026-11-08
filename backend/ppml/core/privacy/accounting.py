"""Privacy accounting for the (Poisson-)subsampled Gaussian mechanism.

Wraps Opacus' accountants:

* ``rdp`` – Rényi DP accountant (Mironov 2017; Mironov, Talwar & Zhang 2019), the Opacus default.
* ``prv`` – Privacy Random Variable accountant (Gopi, Lee & Wutschitz 2021); tighter bounds.
* ``gdp`` – Gaussian DP via the CLT (Dong, Roth & Su 2019). Asymptotic approximation only; it is
  not a rigorous upper bound for small numbers of steps and is shown for comparison.

Assumptions shared by every accountant here: each step applies the Gaussian mechanism with
noise standard deviation ``noise_multiplier × max_grad_norm`` to the sum of per-example
gradients clipped to L2 norm ``max_grad_norm``, on a batch formed by **Poisson sampling** with
rate ``sample_rate``; neighbouring datasets differ by adding/removing one record.
Composition across steps is handled by the accountant.
"""

from __future__ import annotations

from typing import Any, Literal

from opacus.accountants import GaussianAccountant, PRVAccountant, RDPAccountant
from opacus.accountants.accountant import IAccountant
from opacus.accountants.utils import get_noise_multiplier

AccountantName = Literal["rdp", "prv", "gdp"]

ACCOUNTANT_INFO: dict[str, dict[str, str]] = {
    "rdp": {
        "name": "Rényi DP (RDP)",
        "reference": "Mironov, 'Rényi Differential Privacy', CSF 2017; "
        "Mironov, Talwar, Zhang, 'Rényi DP of the Sampled Gaussian Mechanism', 2019",
        "rigour": "Rigorous upper bound on epsilon (conversion from RDP is slightly loose).",
    },
    "prv": {
        "name": "Privacy Random Variable (PRV)",
        "reference": "Gopi, Lee, Wutschitz, 'Numerical Composition of Differential Privacy', NeurIPS 2021",
        "rigour": "Numerical upper bound with controlled discretisation error; usually tighter than RDP.",
    },
    "gdp": {
        "name": "Gaussian DP (CLT)",
        "reference": "Dong, Roth, Su, 'Gaussian Differential Privacy', JRSS-B 2022",
        "rigour": "Central-limit approximation — NOT a guaranteed upper bound. Comparison only.",
    },
}


def make_accountant(name: AccountantName) -> IAccountant:
    if name == "rdp":
        return RDPAccountant()
    if name == "prv":
        return PRVAccountant()
    if name == "gdp":
        return GaussianAccountant()
    raise ValueError(f"Unknown accountant '{name}'")


def validate_params(noise_multiplier: float, sample_rate: float, steps: int, delta: float) -> None:
    if noise_multiplier <= 0:
        raise ValueError("noise_multiplier must be > 0")
    if not 0 < sample_rate <= 1:
        raise ValueError("sample_rate must be in (0, 1]")
    if steps < 1:
        raise ValueError("steps must be >= 1")
    if not 0 < delta < 1:
        raise ValueError("delta must be in (0, 1)")


def epsilon_for(
    noise_multiplier: float, sample_rate: float, steps: int, delta: float, accountant: AccountantName = "rdp"
) -> float:
    """Epsilon spent after ``steps`` compositions of the subsampled Gaussian mechanism."""
    validate_params(noise_multiplier, sample_rate, steps, delta)
    acc = make_accountant(accountant)
    acc.history = [(noise_multiplier, sample_rate, steps)]
    return float(acc.get_epsilon(delta=delta))


def noise_for_target(
    target_epsilon: float, delta: float, sample_rate: float, steps: int, accountant: AccountantName = "rdp"
) -> float:
    """Smallest noise multiplier that keeps epsilon ≤ ``target_epsilon`` (binary search)."""
    if target_epsilon <= 0:
        raise ValueError("target_epsilon must be > 0")
    validate_params(1.0, sample_rate, steps, delta)
    return float(
        get_noise_multiplier(
            target_epsilon=target_epsilon,
            target_delta=delta,
            sample_rate=sample_rate,
            steps=steps,
            accountant=accountant,
            epsilon_tolerance=0.01,
        )
    )


def epsilon_curve(
    noise_multiplier: float,
    sample_rate: float,
    total_steps: int,
    delta: float,
    accountant: AccountantName = "rdp",
    points: int = 25,
) -> list[dict[str, float]]:
    """Epsilon as a function of the number of steps (composition over training)."""
    out = []
    for i in range(1, points + 1):
        s = max(1, round(total_steps * i / points))
        out.append({"step": s, "epsilon": epsilon_for(noise_multiplier, sample_rate, s, delta, accountant)})
    return out


def calculator(
    n: int,
    batch_size: int,
    epochs: int,
    delta: float,
    noise_multiplier: float | None = None,
    target_epsilon: float | None = None,
    accountant: AccountantName = "rdp",
) -> dict[str, Any]:
    """Interactive calculator used by the DP Studio before a training run."""
    if n < 2 or batch_size < 1 or epochs < 1:
        raise ValueError("n, batch_size and epochs must be positive")
    if batch_size > n:
        raise ValueError("batch_size cannot exceed dataset size")
    # Mirror Opacus' DPDataLoader: sample_rate = 1 / len(loader), len(loader) = ceil(n / B).
    batches = -(-n // batch_size)
    q = 1.0 / batches
    steps = int(epochs * batches)
    if noise_multiplier is None:
        if target_epsilon is None:
            raise ValueError("Provide noise_multiplier or target_epsilon")
        noise_multiplier = noise_for_target(target_epsilon, delta, q, steps, accountant)
    eps = epsilon_for(noise_multiplier, q, steps, delta, accountant)
    comparison: dict[str, float | str | None] = {}
    for name in ("rdp", "prv", "gdp"):
        try:
            comparison[name] = epsilon_for(noise_multiplier, q, steps, delta, name)  # type: ignore[arg-type]
        except Exception as exc:  # noqa: BLE001 - surface accountant numerical failures
            comparison[name] = None
            comparison[f"{name}_error"] = str(exc)[:200]
    return {
        "n": n,
        "sample_rate": q,
        "steps": steps,
        "delta": delta,
        "delta_recommended_max": 1.0 / n,
        "delta_ok": delta < 1.0 / n,
        "noise_multiplier": noise_multiplier,
        "epsilon": eps,
        "accountant": accountant,
        "accountant_info": ACCOUNTANT_INFO[accountant],
        "comparison": comparison,
        "curve": epsilon_curve(noise_multiplier, q, steps, delta, accountant, points=20),
    }
