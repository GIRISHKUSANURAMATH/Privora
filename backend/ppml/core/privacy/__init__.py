"""Differential privacy engine and accounting.

Two Opacus/PyTorch warnings are silenced because they are expected here and documented:
* "Secure RNG turned off" — secure_mode is opt-in (see DPConfig.secure_mode and the methodology doc).
* "Full backward hook is firing ..." — inputs do not require gradients in tabular training; the
  per-sample gradient hooks still run correctly.
"""

import warnings

warnings.filterwarnings("ignore", message=r"Secure RNG turned off", category=UserWarning)
warnings.filterwarnings("ignore", message=r"Full backward hook is firing", category=UserWarning)
