"""Privora — a Privacy-Preserving Machine Learning Framework.

The package is organised into:

* ``ppml.core.data``        – dataset loading, validation, synthetic data, PII detection, transforms
* ``ppml.core.ml``          – tabular models, training loops, evaluation, safe artifact storage
* ``ppml.core.privacy``     – Differential Privacy (Opacus DP-SGD) and privacy accounting
* ``ppml.core.federated``   – Federated Averaging simulator with optional client-level DP
* ``ppml.core.attacks``     – membership inference and leakage analysis
* ``ppml.core.experiments`` – experiment orchestration and persistence
* ``ppml.core.reports``     – report generation
* ``ppml.api``              – FastAPI HTTP layer
"""

__version__ = "1.0.0"
