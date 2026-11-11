# Privacy Methodology

This document states exactly what each privacy mechanism in Privora does, what guarantee (if any)
it provides, and under which assumptions. The implementation is the source of truth; file
references are given for each claim.

## 1. Definitions

**(ε, δ)-differential privacy** (Dwork, McSherry, Nissim & Smith 2006; Dwork & Roth 2014).
A randomised mechanism *M* satisfies (ε, δ)-DP if for all neighbouring datasets *D, D′* and all
measurable sets *S*:

    Pr[M(D) ∈ S] ≤ e^ε · Pr[M(D′) ∈ S] + δ

* **Adjacency used here:** *add/remove one record* (Opacus' default for Poisson sampling).
* **Unit of privacy:** one row. If one person contributes several rows the guarantee per person
  is weaker (group privacy: roughly kε for k rows).
* **δ** must be much smaller than 1/n. The DP engine rejects δ ≥ 1/n (`dp.py: DPConfig.validate`).

## 2. Deployment models

| Model | Who is trusted | Where noise is added | In Privora |
|---|---|---|---|
| Central DP | the curator/trainer | to the model (gradients) | DP Studio (DP-SGD) |
| Local DP | nobody | to each record before it leaves the owner | Inspector "Local DP" action |
| Client-level DP (federated) | the aggregation server | to the sum of client updates | DP-FedAvg |
| Example-level DP per client (federated) | nobody beyond the client | inside each client's training | Local DP-SGD mode |

## 3. DP-SGD (central, example-level)

Implementation: `backend/ppml/core/privacy/dp.py`, using Opacus `PrivacyEngine`.

Per step *t*:

1. **Poisson sampling:** each training record is included independently with probability
   *q = 1 / ⌈N/B⌉* (Opacus `DPDataLoader`, `poisson_sampling=True`). Batch sizes vary; empty
   batches are skipped.
2. **Per-sample gradients** via Opacus `GradSampleModule`.
3. **Clipping:** each per-sample gradient *g_i* is scaled to `g_i · min(1, C / ‖g_i‖₂)`.
4. **Noise:** `Σ g_i + N(0, σ²C² I)`; the result is divided by the expected batch size *qN*.
5. Optimiser step (Adam or SGD — post-processing of a DP output, so the guarantee is unaffected).

**Accounting.** Each step is one application of the sampled Gaussian mechanism; *T = epochs/q*
steps are composed by the accountant:

* `rdp` — Rényi DP (Mironov 2017) with the sampled-Gaussian analysis of Mironov, Talwar & Zhang
  (2019), converted to (ε, δ). **Default.** Rigorous upper bound.
* `prv` — Privacy Random Variable accountant (Gopi, Lee & Wutschitz 2021). Rigorous with bounded
  numerical error; usually a tighter ε than RDP.
* `gdp` — Gaussian DP via a central-limit approximation (Dong, Roth & Su 2022). **Not** a
  guaranteed bound; shown in the calculator for comparison only and not selectable for training.

**Target-ε mode** calls Opacus `make_private_with_epsilon`, which binary-searches the smallest
σ such that ε(T) ≤ target (tolerance 0.01). The reported ε is read back from the accountant
after training, and a test re-computes it independently (`test_dp_training_respects_target`).

**Diagnostics** reported but not part of the guarantee: the fraction of per-sample gradients
that were actually clipped each epoch, and test accuracy per epoch.

### What the DP-SGD guarantee does *not* cover

* **Preprocessing statistics.** Means, standard deviations, medians and category lists used by
  the encoder are computed from the training split without noise and are treated as public.
  Strictly, they are a (non-private) function of the data. For a fully private pipeline,
  supply public bounds/categories or spend budget on them.
* **Hyper-parameter tuning.** Each run is accounted separately; choosing the best of many runs
  consumes additional, unaccounted privacy (Papernot & Steinke 2022).
* **Evaluation on the test split** is not a release of training data; reported test metrics
  are outside the guarantee by design.
* **Floating-point and RNG side channels.** `secure_mode=False` uses PyTorch's PRNG.

## 4. Federated learning

Implementation: `backend/ppml/core/federated/fedavg.py`.

**FedAvg** (McMahan et al. 2017): each round, *m = round(f·K)* clients are drawn uniformly
without replacement; each runs *E* local epochs of SGD from the current global model; the
server sets `w ← w + Σ_k (n_k / Σn) (w_k − w)`. **Guarantee: none.** Raw records stay local,
but updates are functions of the data (Zhu et al. 2019, "Deep Leakage from Gradients").

**DP-FedAvg / client-level DP** (McMahan, Ramage, Talwar & Zhang 2018):

* each client is included **independently with probability q = f** (Poisson sampling — required
  by the accountant; the number of participants varies per round);
* client update Δ_k is clipped to L2 norm *S*;
* the server computes `(Σ clipped Δ_k + N(0, z²S² I)) / (qK)` (fixed-denominator estimator);
* privacy is accounted with the RDP accountant for the sampled Gaussian mechanism with noise
  multiplier *z*, sampling rate *q* and *T = rounds* compositions.

Guarantee: (ε, δ)-DP with respect to adding/removing **one client's entire dataset**.
Assumes the server is trusted to add noise honestly. With few clients (as in a laptop
simulation) the noise dominates the signal — a real and visible utility cost.

**Local DP-SGD in each client:** each client runs Opacus DP-SGD with its own accountant across
all rounds in which it participates. The update leaving the client is (ε_k, δ)-DP with respect
to that client's records, so it holds even against a curious server. The UI reports
`max_k ε_k`. Clients with fewer rows have larger q and thus larger ε.

**Partitioning:** IID random split, or label-skewed Dirichlet(α) per class (Hsu et al. 2019).

## 5. Local DP for individual columns

Implementation: `backend/ppml/core/data/transforms.py::_local_dp`.

* **Numeric:** values are clipped to [L, U] and released as `x + Laplace(0, (U − L)/ε)`.
  This is ε-LDP **only if L and U are public**; if they are taken from the data, the report says
  so explicitly.
* **Categorical:** k-ary randomised response — keep the true value with probability
  `e^ε / (e^ε + k − 1)`, otherwise output one of the other k − 1 values uniformly (Warner 1965;
  Kairouz et al. 2016). ε-LDP per record per attribute. The category set is taken from the data.
* Applying local DP to several columns composes: total ε per record is the sum.

## 6. Non-DP protections

| Technique | What it does | Guarantee |
|---|---|---|
| Suppression | drops the column | none (minimisation) |
| Redaction | replaces with `[REDACTED]` | none |
| Masking | keeps format hints (`a***@example.com`, `*****0142`) | none; partial values may still identify |
| Pseudonymisation | HMAC-SHA256 with a random 256-bit key held only in memory | none; consistent tokens enable linkage; still personal data in GDPR terms |
| Generalisation | numeric binning / string prefix truncation | none by itself; measured with k-anonymity |

**k-anonymity** (Sweeney 2002) is reported over the detected quasi-identifiers. It measures
re-identifiability by linking, not by inference; it is known to be insufficient against
homogeneity and background-knowledge attacks (Machanavajjhala et al. 2007).

## 7. Attack evaluation

Implementation: `backend/ppml/core/attacks/membership.py`.

* **Setup:** target trained on `members` (the training split, capped to make overfitting visible);
  non-members are held-out rows; a disjoint **shadow pool** represents the attacker's own data.
* **Balanced evaluation:** equal numbers of members and non-members.
* **Calibration:** the evaluation set is split in half; thresholds are chosen on one half to
  maximise balanced accuracy and all reported threshold metrics come from the other half.
* **Attacks:** loss threshold (Yeom et al. 2018), confidence threshold, shadow models with a
  gradient-boosted attack classifier on [true-class confidence, loss, entropy, sorted
  probabilities] (Shokri et al. 2017), attribute inference by confidence maximisation
  (Fredrikson et al. 2015).
* **Metrics:** ROC-AUC, accuracy, precision, recall, membership advantage TPR − FPR, TPR at 1 %
  and 10 % FPR (Carlini et al. 2022), confidence and loss histograms.
* **Attack-implied ε (heuristic):** using Clopper–Pearson 95 % intervals on the evaluation half,
  `ln((TPR_lower − δ) / FPR_upper)`, taking the stronger of the two directions. The formula is
  the one used in DP auditing (Jagielski et al. 2020; Nasr et al. 2021), **but this is not a valid
  audit**: those methods repeat training many times (or use one-run auditing with randomised
  canaries, Steinke et al. 2023) so that each guess is an independent trial. Here all members and
  non-members come from one training run, so the confidence interval does not carry over to a
  DP statement. Treat it as an indicator of how strongly this attack separates the two groups. It can
  never certify privacy.

## 8. What Privora does not claim

* No claim of anonymity for masked/pseudonymised/generalised data.
* No privacy claim for FedAvg without DP.
* No regulatory compliance (GDPR, HIPAA, India's DPDP Act, etc.).
* No production-grade security; see [`THREAT_MODEL.md`](THREAT_MODEL.md).

## References

Abadi et al., *Deep Learning with Differential Privacy*, CCS 2016 ·
Carlini et al., *Membership Inference Attacks From First Principles*, IEEE S&P 2022 ·
Dong, Roth, Su, *Gaussian Differential Privacy*, JRSS-B 2022 ·
Dwork & Roth, *The Algorithmic Foundations of Differential Privacy*, 2014 ·
Fredrikson, Jha, Ristenpart, *Model Inversion Attacks*, CCS 2015 ·
Gopi, Lee, Wutschitz, *Numerical Composition of Differential Privacy*, NeurIPS 2021 ·
Hsu, Qi, Brown, *Measuring the Effects of Non-Identical Data Distribution*, 2019 ·
Jagielski, Ullman, Oprea, *Auditing Differentially Private Machine Learning*, NeurIPS 2020 ·
Kairouz, Bonawitz, Ramage, *Discrete Distribution Estimation under Local Privacy*, ICML 2016 ·
Machanavajjhala et al., *ℓ-Diversity*, TKDD 2007 ·
McMahan et al., *Communication-Efficient Learning of Deep Networks from Decentralized Data*, AISTATS 2017 ·
McMahan, Ramage, Talwar, Zhang, *Learning Differentially Private Recurrent Language Models*, ICLR 2018 ·
Mironov, *Rényi Differential Privacy*, CSF 2017 ·
Mironov, Talwar, Zhang, *Rényi Differential Privacy of the Sampled Gaussian Mechanism*, 2019 ·
Nasr et al., *Adversary Instantiation: Lower Bounds for Differentially Private ML*, IEEE S&P 2021 ·
Papernot & Steinke, *Hyperparameter Tuning with Rényi Differential Privacy*, ICLR 2022 ·
Shokri et al., *Membership Inference Attacks Against Machine Learning Models*, IEEE S&P 2017 ·
Sweeney, *k-Anonymity*, IJUFKS 2002 ·
Warner, *Randomized Response*, JASA 1965 ·
Yeom et al., *Privacy Risk in Machine Learning*, CSF 2018 ·
Yousefpour et al., *Opacus: User-Friendly Differential Privacy Library in PyTorch*, 2021 ·
Zhu, Liu, Han, *Deep Leakage from Gradients*, NeurIPS 2019.
