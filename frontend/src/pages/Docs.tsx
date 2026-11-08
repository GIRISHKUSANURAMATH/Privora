import { BookOpen } from "lucide-react";
import { useState } from "react";
import { BrandMark, PageHeader } from "../components/Layout";
import { Callout } from "../components/ui";

const SECTIONS = [
  {
    id: "dp",
    title: "Differential privacy",
    body: (
      <>
        <p>
          A randomised algorithm M is <b>(ε, δ)-differentially private</b> if for every pair of datasets D, D′ differing in one record and every set of outputs S: Pr[M(D) ∈ S] ≤ e<sup>ε</sup>·Pr[M(D′) ∈ S] + δ. Small ε means the output barely depends on any one person; δ is the small probability the bound fails and should be far below 1/n.
        </p>
        <h3>Central, local and client-level</h3>
        <ul>
          <li>
            <b>Central DP</b> — a trusted curator holds raw data and releases a noisy result (here: the trained model). Used by the DP Studio.
          </li>
          <li>
            <b>Local DP</b> — each record is randomised before it leaves its owner, so no one needs to be trusted. Much noisier for the same ε. Used by the Inspector's “Local DP” action and by local DP-SGD in the federated studio (per client).
          </li>
          <li>
            <b>Client-level DP</b> — in federated learning, neighbouring datasets differ by an entire client. DP-FedAvg protects whether a client participated at all.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "dpsgd",
    title: "DP-SGD and accounting",
    body: (
      <>
        <p>
          DP-SGD (Abadi et al., 2016) changes each optimiser step: sample a batch by Poisson sampling with rate q = B/N, compute per-example gradients, clip each to L2 norm C, sum, add Gaussian noise N(0, σ²C²), and divide by the expected batch size. Opacus implements the per-sample gradients, clipping, noise and sampler.
        </p>
        <p>
          Each step is a subsampled Gaussian mechanism. The accountant composes all T = epochs/q steps. Umbra uses Opacus' <b>RDP</b> accountant by default (Mironov 2017; Mironov, Talwar &amp; Zhang 2019) and offers <b>PRV</b> (Gopi et al., 2021), which is numerically tighter. Gaussian DP is shown only as a comparison because its CLT approximation is not a guaranteed bound.
        </p>
        <Callout tone="violet" title="Assumptions behind every ε shown">
          Add/remove-one-record adjacency; one row per person; Poisson sampling as implemented by Opacus' DPDataLoader; preprocessing statistics treated as public; no accounting for hyper-parameter search across runs; non-cryptographic RNG unless secure mode is enabled.
        </Callout>
      </>
    ),
  },
  {
    id: "fl",
    title: "Federated learning",
    body: (
      <>
        <p>
          FedAvg (McMahan et al., 2017) repeats: the coordinator sends the global model to a subset of clients; each trains for a few local epochs on its own data; the coordinator replaces the global weights with the sample-weighted average of the returned models. Raw rows never leave a client.
        </p>
        <p>
          That alone is <b>not</b> a privacy guarantee. Updates are functions of the data, and gradient-inversion and membership attacks can recover information from them. Umbra offers two fixes: DP-FedAvg (McMahan et al., 2018) — clip each client update to norm S, add N(0, z²S²) to the sum on the server, divide by the expected number of clients — and local DP-SGD on every client.
        </p>
        <p>Non-IID data is simulated with a per-class Dirichlet(α) split; smaller α gives clients more skewed label mixes.</p>
      </>
    ),
  },
  {
    id: "attacks",
    title: "Privacy attacks",
    body: (
      <>
        <ul>
          <li>
            <b>Loss / confidence threshold</b> (Yeom et al., 2018) — members tend to have lower loss and higher confidence than unseen records.
          </li>
          <li>
            <b>Shadow models</b> (Shokri et al., 2017) — the attacker trains models on its own data from the same distribution, labels their outputs as in/out, and trains a classifier to recognise members.
          </li>
          <li>
            <b>Attribute inference</b> (Fredrikson et al., 2015) — knowing everything but one attribute plus the label, try each value and pick the one the model is most confident about.
          </li>
        </ul>
        <p>
          Reported metrics: ROC-AUC, accuracy, precision, recall, membership advantage (TPR − FPR), TPR at 1% and 10% FPR (Carlini et al., 2022), and an attack-implied ε, ln((TPR − δ)/FPR) with Clopper–Pearson 95% intervals. That last number is a <b>heuristic</b>: it comes from a single training run, whose member/non-member samples are not the independent trials a valid DP audit needs (that requires many training runs or one-run auditing with randomised canaries, Steinke et al. 2023). It can suggest a model leaks; it can never certify privacy.
        </p>
      </>
    ),
  },
  {
    id: "data",
    title: "Data protection techniques",
    body: (
      <>
        <p>
          <b>Suppression</b> removes columns; <b>redaction</b> replaces values; <b>masking</b> keeps a format hint; <b>pseudonymisation</b> uses an HMAC-SHA256 token with an ephemeral key; <b>generalisation</b> bins or truncates. None of these is a formal guarantee: the Inspector measures k-anonymity over quasi-identifiers to show how many records remain unique.
        </p>
        <p>
          <b>Local DP</b> on a column uses the Laplace mechanism with scale (upper − lower)/ε for numbers and k-ary randomised response for categories. If bounds are taken from the data itself, that step is not private; supply public bounds for a strict guarantee.
        </p>
      </>
    ),
  },
  {
    id: "limits",
    title: "Limitations",
    body: (
      <ul>
        <li>PII detection is heuristic and English/format-centric; it will miss identifiers and flag false positives.</li>
        <li>Datasets are synthetic by default. Results on them demonstrate mechanisms, not real-world utility.</li>
        <li>Federated learning is simulated in one process; there is no network transport, secure aggregation or client authentication.</li>
        <li>The API has no authentication and binds to 127.0.0.1. Do not expose it on a network.</li>
        <li>Nothing here constitutes regulatory compliance (GDPR, HIPAA, DPDP Act or otherwise).</li>
      </ul>
    ),
  },
];

export default function Docs() {
  const [active, setActive] = useState(SECTIONS[0].id);
  const s = SECTIONS.find((x) => x.id === active)!;
  return (
    <div>
      <PageHeader icon={<BookOpen className="size-5" />} title="Documentation" description="What each engine does, what its guarantees assume, and where the limits are. The repository's docs folder has the full methodology, threat model and API reference." />
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <nav aria-label="Documentation sections" className="panel self-start p-2">
          {SECTIONS.map((x) => (
            <button key={x.id} onClick={() => setActive(x.id)} aria-current={active === x.id} className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${active === x.id ? "bg-indigo/12 text-ink" : "text-ink-2 hover:bg-raised"}`}>
              {x.title}
            </button>
          ))}
        </nav>
        <article className="panel max-w-[78ch] p-6 sm:p-8 [&_b]:font-semibold [&_b]:text-ink [&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-ink [&_li]:mt-2 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
          <h2 className="text-xl font-semibold text-ink">{s.title}</h2>
          <div className="text-[15px] leading-[1.7] text-ink-2">{s.body}</div>
        </article>
      </div>
      <div className="mt-8 flex items-center gap-4 rounded-xl border border-line bg-surface/60 p-5">
        <BrandMark className="size-10 shrink-0" />
        <div className="text-[13px] leading-relaxed text-muted">
          <p className="font-medium text-ink">Umbra 1.0 — Privacy-Preserving Machine Learning Framework</p>
          <p>FastAPI · PyTorch · Opacus · scikit-learn · React · TypeScript · Tailwind CSS · Recharts. Runs entirely on this machine; no external AI services or paid APIs. MIT licensed.</p>
        </div>
      </div>
    </div>
  );
}
