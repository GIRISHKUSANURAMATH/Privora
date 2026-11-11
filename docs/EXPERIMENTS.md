# Experiments

All numbers below were produced on **8 November 2026** by `scripts/run_experiments.py` against the
running API, in a clean data directory, and copied mechanically from
[`results/experiments.json`](results/experiments.json) (the full raw output, including
per-epoch histories, ROC curves and per-client metrics). Nothing was edited by hand.

**Environment of this run:** Linux x86-64 container, 2 CPU cores, no GPU, Python 3.13.18,
PyTorch 2.15.0, Opacus 1.6.0, scikit-learn 1.9.1. Re-running on a different machine gives very
similar but not bit-identical numbers (thread scheduling and BLAS differ); seeds are fixed.

**Dataset:** *Synthetic Patient Risk*, 4,000 generated rows + 20 injected duplicates = 4,020
rows, seed 7. Fictional people only. Label `high_risk` (≈ 40 % positive in the training split) is generated from a
known logistic model of age, BMI, blood pressure, cholesterol, glucose, exercise and smoking
plus noise, so ≈ 72 % accuracy is close to what the features allow. Direct identifiers are
excluded from training automatically.

**Common model:** MLP 24 → 64 → 32 → 2 (ReLU), Adam lr 0.002, batch 128, 15 epochs, seed 42,
70/30 split (2,814 train / 1,206 test), unless stated otherwise.

Reproduce: `.\run.ps1` in one window, then `.\.venv\Scripts\python scripts\run_experiments.py`.

---

## Experiment A — Conventional vs differentially private training

DP-SGD with target ε = 3, δ = 1e-5, clipping norm C = 1, RDP accountant, Poisson sampling.
Opacus chose σ = 1.5039, C = 1.0, q = 0.04545, steps = 330, accountant = RDP, ε = 2.9976 (target 3.0), δ = 1e-05.

| Model | Accuracy | Precision | Recall | F1 | ROC-AUC | ε (δ=1e-5) | σ | Train time |
|---|---|---|---|---|---|---|---|---|
| Conventional | 71.56% | 62.93% | 60.31% | 0.6159 | 0.7617 | none | — | 0.64 s |
| DP-SGD | 71.81% | 64.50% | 56.58% | 0.6028 | 0.7759 | 2.998 | 1.504 | 1.66 s |

**Reading it.** On this dataset DP-SGD at ε ≈ 3 costs essentially nothing in accuracy
(+0.25 pt, within run-to-run noise) and slightly shifts the precision/recall balance
(recall −3.7 pt). That is plausible here: the task is low-dimensional and a 15-epoch
conventional MLP is not over-fitting, so clipping + noise acts like regularisation. It
should **not** be read as "DP is free" in general — see Experiments B and D.

## Experiment B — Privacy budget sweep

Six independent DP-SGD runs (same split, seed and architecture), each with its own accountant.
Conventional reference accuracy: **71.56%**.

| Target ε | Achieved ε | σ | Accuracy | Δ vs non-private | Precision | Recall | F1 | ROC-AUC |
|---|---|---|---|---|---|---|---|---|
| 0.25 | 0.242 | 12.500 | 62.19% | -9.37 pt | 0.00% | 0.00% | 0.0000 | 0.7535 |
| 0.5 | 0.492 | 6.562 | 64.51% | -7.05 pt | 83.33% | 7.68% | 0.1406 | 0.7648 |
| 1 | 1.000 | 3.516 | 72.31% | +0.75 pt | 67.73% | 51.10% | 0.5825 | 0.7694 |
| 2 | 1.996 | 2.007 | 72.31% | +0.75 pt | 65.17% | 57.46% | 0.6107 | 0.7738 |
| 4 | 3.995 | 1.257 | 71.97% | +0.41 pt | 64.75% | 56.80% | 0.6051 | 0.7769 |
| 8 | 7.999 | 0.880 | 72.22% | +0.66 pt | 65.32% | 56.58% | 0.6063 | 0.7789 |

**Reading it.** There is a sharp knee between ε = 0.5 and ε = 1. Below it the noise needed
(σ ≥ 6.5) swamps the gradient signal within 15 epochs and the model collapses towards the
majority class (recall 0–8 %, F1 ≤ 0.14), even though ROC-AUC stays ≈ 0.75 — the ranking is
learned but the decision threshold is not. From ε = 1 upward utility is on par with the
non-private model. Train time roughly doubles with DP because of per-sample gradients.

## Experiment C — Federated learning

### C1 · FedAvg, 10 IID clients, no DP

20 rounds, 50 % of clients per round (5 of 10, uniform without replacement), 2 local epochs,
SGD lr 0.05, batch 32.

| Round | 1 | 5 | 10 | 15 | 20 |
|---|---|---|---|---|---|
| Global accuracy | 62.77% | 64.93% | 71.81% | 72.39% | 73.13% |

Summary: final global accuracy 73.13% (F1 0.6233) vs centralized 71.31% (F1 0.6272); 100 client updates, 1.50 MB uploaded; client sizes [282, 282, 282, 282, 281, 281, 281, 281, 281, 281]; ε = —; wall-clock 3.2 s.

### C2 · FedAvg, 10 non-IID clients (Dirichlet α = 1.0) with local DP-SGD

Same schedule; each client trains with Opacus DP-SGD (σ = 1.0, C = 1.0, δ = 1e-4) and keeps
its own RDP accountant across the rounds it joins.

| Round | 1 | 5 | 10 | 15 | 20 |
|---|---|---|---|---|---|
| Global accuracy | 62.19% | 62.19% | 65.84% | 72.31% | 71.72% |
| ε (max over clients) | 5.28 | 11.14 | 17.83 | 22.00 | 24.61 |

Summary: final global accuracy 71.72% (F1 0.6232) vs centralized 71.31% (F1 0.6272); 100 client updates, 1.50 MB uploaded; client sizes [834, 63, 89, 257, 374, 160, 272, 132, 530, 103]; ε = 24.609; wall-clock 19.9 s.

**Reading it.** Federated training reaches centralized accuracy in both settings. The
privacy cost of local DP-SGD is high: small clients have a large sampling rate (e.g. 63 rows
with batch 32 → q ≈ 0.5), so ε grows quickly with every round they join; the reported ε = 24.6
is the worst client. Plain FedAvg (C1) has **no** formal guarantee at all. Client-level DP
(DP-FedAvg) is implemented and tested but, with only 10 simulated clients, its noise
dominates; it is designed for thousands of clients.

## Experiment D — Membership inference: conventional vs DP

Target models: MLP 24 → 256 → 128 → 2, 120 epochs, batch 64, trained on **600** members (to
make over-fitting — the realistic worst case — visible). Non-members: 1,005 held-out rows.
Attacker: a disjoint shadow pool of 1,005 rows and 3 shadow models. 500 members + 500
non-members are attacked; thresholds are fitted on one half and metrics reported on the other.

| Target | Test acc | Train acc | Attack | AUC | Accuracy | Precision | Recall | Advantage | TPR@1%FPR | TPR@10%FPR | Attack-implied ε (heuristic) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Conventional | 63.08% | 100.00% | Loss threshold | 0.745 | 79.40% | 71.39% | 97.58% | 0.591 | 0.00% | 0.00% | 2.36 |
| Conventional | 63.08% | 100.00% | Entropy threshold | 0.630 | 69.00% | 61.89% | 97.58% | 0.385 | 0.81% | 16.13% | 1.90 |
| Conventional | 63.08% | 100.00% | Shadow models (3) | 0.820 | 78.00% | 71.17% | 93.55% | 0.562 | 0.00% | 43.55% | 1.70 |
| DP ε=1 | 63.58% | 63.83% | Loss threshold | 0.523 | 49.40% | 49.27% | 67.74% | -0.009 | 0.00% | 15.73% | 0.00 |
| DP ε=1 | 63.58% | 63.83% | Entropy threshold | 0.543 | 51.80% | 51.19% | 60.89% | 0.037 | 0.00% | 14.11% | 0.00 |
| DP ε=1 | 63.58% | 63.83% | Shadow models (3) | 0.494 | 50.40% | 0.00% | 0.00% | 0.000 | 0.00% | 0.00% | 0.00 |
| DP ε=8 | 71.04% | 74.17% | Loss threshold | 0.533 | 52.00% | 51.67% | 50.00% | 0.040 | 2.82% | 18.55% | 0.00 |
| DP ε=8 | 71.04% | 74.17% | Entropy threshold | 0.516 | 51.20% | 50.68% | 60.48% | 0.025 | 2.82% | 18.15% | 0.00 |
| DP ε=8 | 71.04% | 74.17% | Shadow models (3) | 0.524 | 51.20% | 51.67% | 25.00% | 0.020 | 1.21% | 13.71% | 0.00 |

| Target | ε | Generalisation gap | Confidence gap | Leakage level | Attribute inference (members / non-members / majority baseline) |
|---|---|---|---|---|---|
| Conventional | none | 36.9 pt | 0.380 | high | smoker: 54.00% / 39.33% / 60.67% |
| DP ε=1 | 0.995 | 0.3 pt | 0.002 | low | smoker: 46.17% / 42.17% / 60.67% |
| DP ε=8 | 7.994 | 3.1 pt | 0.052 | low | smoker: 47.50% / 48.67% / 60.67% |

**Reading it.**

* The conventional target memorises its training set (100 % train vs 63 % test accuracy) and
  all three attacks detect membership well above chance; the shadow-model attack reaches
  AUC 0.82, and the heuristic attack-implied ε is ≈ 2.4. (That figure comes from one training
  run and is not a valid DP audit bound; it only indicates strong separation.) This model
  cannot honestly be called private.
* Both DP targets bring every attack to chance level (AUC 0.49–0.54, advantage ≤ 0.04) and
  close the generalisation gap.
* The cost is visible: at ε ≈ 1 the 600-row model needs σ ≈ 14 and barely beats the
  majority class (recall 12 %); at ε ≈ 8 it is the most *accurate* of the three (71.0 %),
  because DP prevents the over-fitting that hurt the conventional model.
* Attribute inference of `smoker` (chosen automatically as the categorical feature with the
  highest mutual information with the label) did **not** beat the majority-class baseline
  for any target. This model/dataset does not leak that attribute through confidence scores;
  the demonstration is reported as a negative result rather than tuned until it "works".
* Low TPR at 1 % FPR for the conventional model despite AUC 0.75 is real: many non-members
  are easy examples that also get near-zero loss, so the very-low-FPR region contains ties.

## Experiment E — PII protection

Recommended protections from the Privacy Inspector, applied to the same dataset:
full_name → suppress, email → mask, phone → mask, national_id → suppress, age → generalize, gender → generalize, zip_code → generalize, city → generalize.

| Measure | Before | After |
|---|---|---|
| Direct identifiers | full_name, email, phone, national_id | none |
| Heuristic risk score | 100.0 (high) | 44.6 (medium) |
| Records unique on age+gender+zip_code+city | 93.18% | 4.78% |
| Equivalence classes | 3882 | 997 |
| k-anonymity (smallest class) | 1 | 1 |
| Model accuracy (same MLP, 12 epochs) | 71.48% | 69.90% |

**Reading it.** All four direct identifiers are removed or masked (masked e-mail and phone
are re-classified as quasi-identifiers because the domain and last digits remain).
Generalisation cuts the share of records unique on the four quasi-identifiers from 93 % to
4.8 %, but k is still 1: some records remain unique, so the protected data is **not**
anonymous. The accuracy cost of generalising age into bands and truncating ZIP codes is
−1.6 pt.

## Run times

Wall-clock seconds per experiment on 2 CPU cores: A 3.0, B 12.3, C 3.7, C2 21.3, D 36.0, E 1.8.

## Limitations of these results

* One synthetic dataset, one seed per configuration; differences under ~1 pt are within noise.
* The privacy accounting excludes preprocessing statistics and hyper-parameter selection
  (see `PRIVACY_METHODOLOGY.md`).
* Attack results measure only the attacks implemented. They are not a bound on leakage:
  stronger attacks (e.g. LiRA with many shadow models) could do better against the
  conventional model.
