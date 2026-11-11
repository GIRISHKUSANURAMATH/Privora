# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.0.x | yes |

## Scope and intended use

Privora is a **local, single-user research tool**. It binds to `127.0.0.1`, has **no
authentication**, and must not be exposed on a network or used as a production service.
See [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) for assets, mitigations and residual risks.

Privacy guarantees are stated with their assumptions in
[`docs/PRIVACY_METHODOLOGY.md`](docs/PRIVACY_METHODOLOGY.md). Nothing in this project
constitutes regulatory compliance.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub's
**Security → Report a vulnerability** (private advisory) on this repository rather than in a
public issue. Include steps to reproduce, affected version and impact. You should receive an
acknowledgement within 7 days.

## Built-in controls

* Host-header allow-list (DNS-rebinding protection)
* Streaming request-body limit enforced before parsing (covers chunked uploads)
* Upload validation: extension allow-list, size limit, binary sniffing, UTF-8, row/column limits
* Exported reports never contain the original (pre-masking) sample rows
* Server-generated IDs for all stored files; path-traversal checks
* App state as JSON; model weights reloaded only with `torch.load(weights_only=True)` (no pickle/joblib of arbitrary objects)
* Parameterised SQL with allow-listed identifiers
* CSV formula-injection neutralisation on export; HTML escaping in reports
* Security headers (CSP, X-Frame-Options, nosniff, Referrer-Policy) and localhost-only CORS
* PII-scrubbing JSON logs; generic 500 responses
* Bandit, Ruff security rules, pip-audit and npm audit in `verify.ps1`
