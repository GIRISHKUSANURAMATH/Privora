import clsx from "clsx";
import type { Experiment, FedResult, ModelResult, Results, Row, TransformReport } from "../lib/api";
import { bytes, eps, fx, int, pct, secs } from "../lib/format";
import { useChartColors } from "../lib/theme";
import { Bars, Lines, PrivacyUtility, ROC } from "./charts";
import { MetricBars, MetricsTable, PrivacyLedger, TrainingCurves } from "./shared";
import { Badge, Callout, KV, Panel, Stat } from "./ui";

/* ================================================================== training (A) */
export function TrainingView({ r }: { r: Results }) {
  const models = r.models ?? [];
  const dpModels = models.filter((m) => m.privacy?.accountant);
  const c = useChartColors();
  return (
    <div className="space-y-6">
      {r.utility_cost && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {(["accuracy", "precision", "recall", "f1", "roc_auc"] as const).map((k) => {
            const v = r.utility_cost![k];
            return <Stat key={k} label={`Δ ${k === "roc_auc" ? "ROC-AUC" : k === "f1" ? "F1" : k}`} value={v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)} pt`} tone={v != null && v < -0.03 ? "amber" : "signal"} hint="DP minus conventional" />;
          })}
        </div>
      )}
      <Panel title="Held-out test performance" subtitle={r.data ? `${int(r.data.n_train)} training rows, ${int(r.data.n_test)} test rows, ${r.data.n_features} encoded features` : undefined}>
        <MetricsTable models={models} />
      </Panel>
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Precision, recall and F1">
          <MetricBars models={models} />
        </Panel>
        {dpModels.length > 0 && (
          <Panel title="Privacy budget spent during training" subtitle="ε reported by the accountant after each epoch">
            <Lines
              label="Epsilon spent per epoch"
              data={dpModels[0].history!.epoch.map((e, i) => {
                const row: Record<string, unknown> = { epoch: e };
                dpModels.forEach((m, j) => (row[`e${j}`] = m.history!.epsilon[i]));
                return row;
              })}
              xKey="epoch"
              series={dpModels.map((m, j) => ({ key: `e${j}`, name: m.label, color: [c.violet, c.indigo, c.blue][j % 3] }))}
              yFmt={(v) => v.toFixed(2)}
            />
          </Panel>
        )}
      </div>
      <Panel title="Training dynamics">
        <TrainingCurves models={models} />
      </Panel>
      {dpModels.map((m) => (
        <Panel key={m.model_id} title={`Privacy accounting · ${m.label}`} subtitle="Computed by Opacus during training; nothing here is estimated by the UI.">
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            <PrivacyLedger m={m} />
            {m.privacy?.clip_fraction_per_epoch && (
              <div>
                <p className="mb-2 text-[13px] font-medium text-ink-2">Share of per-sample gradients clipped</p>
                <Lines label="Fraction of clipped per-sample gradients per epoch" data={m.privacy.clip_fraction_per_epoch.map((v, i) => ({ epoch: i + 1, v }))} xKey="epoch" series={[{ key: "v", name: "Clipped", color: c.amber }]} yDomain={[0, 1]} yFmt={(v) => `${Math.round(v * 100)}%`} height={220} />
                <p className="mt-2 text-xs leading-relaxed text-muted">A high clipped share means C is small relative to gradient norms: more bias, but the noise (σ·C) is also smaller.</p>
              </div>
            )}
          </div>
        </Panel>
      ))}
    </div>
  );
}

/* ================================================================== sweep (B) */
export function SweepView({ r }: { r: Results }) {
  const c = useChartColors();
  const curve = r.curve ?? [];
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="Privacy versus utility" subtitle="Each point is a separate DP-SGD training run with its own accountant.">
          <PrivacyUtility label="Test accuracy against achieved epsilon" points={curve.map((p) => ({ epsilon: p.epsilon, accuracy: p.accuracy, name: `ε=${p.target_epsilon}` }))} baseline={r.baseline_accuracy} />
        </Panel>
        <Panel title="Noise needed for each budget" subtitle="Noise multiplier σ found by the accountant for the target ε">
          <Bars label="Noise multiplier per target epsilon" data={curve.map((p) => ({ eps: `ε ${p.target_epsilon}`, sigma: p.noise_multiplier }))} xKey="eps" series={[{ key: "sigma", name: "σ", color: c.violet }]} yFmt={(v) => v.toFixed(2)} />
        </Panel>
      </div>
      <Panel title="Sweep results">
        <div className="scrollbar-thin overflow-x-auto" tabIndex={0} role="region" aria-label="Sweep results">
          <table className="num w-full min-w-[640px] text-left text-[13px]">
            <thead className="text-muted">
              <tr className="border-b border-line">
                {["Target ε", "Achieved ε", "σ", "Accuracy", "Δ vs non-private", "F1", "ROC-AUC", "Time"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium first:pl-0">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {curve.map((p) => (
                <tr key={p.target_epsilon} className="border-b border-line/60 last:border-0">
                  <td className="py-2.5 pr-3 text-violet">{p.target_epsilon}</td>
                  <td className="px-3">{fx(p.epsilon, 3)}</td>
                  <td className="px-3">{fx(p.noise_multiplier, 3)}</td>
                  <td className="px-3">{pct(p.accuracy, 2)}</td>
                  <td className="px-3">{r.baseline_accuracy != null ? `${p.accuracy >= r.baseline_accuracy ? "+" : ""}${((p.accuracy - r.baseline_accuracy) * 100).toFixed(2)} pt` : "—"}</td>
                  <td className="px-3">{fx(p.f1, 4)}</td>
                  <td className="px-3">{fx(p.roc_auc, 4)}</td>
                  <td className="px-3">{secs(p.train_seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">Non-private reference accuracy: {pct(r.baseline_accuracy, 2)}. Achieved ε can sit slightly below the target because the noise search stops within a tolerance.</p>
      </Panel>
      <Panel title="All models">
        <MetricsTable models={r.models ?? []} />
      </Panel>
    </div>
  );
}

/* ================================================================== federated (C) */
export function FederatedView({ r }: { r: Results }) {
  const f = r.federated as FedResult;
  const c = useChartColors();
  const central = r.models?.[0];
  const rounds = f.rounds.map((x) => ({ round: x.round, acc: x.global_accuracy, f1: x.global_f1, eps: x.epsilon, n: x.participants.length, loss: x.mean_local_loss }));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Global accuracy" value={pct(f.final.accuracy)} tone="signal" hint={central ? `centralized: ${pct(central.test.accuracy)}` : undefined} />
        <Stat label="Clients" value={f.clients.length} tone="blue" hint={`${f.rounds.length} rounds`} />
        <Stat label="Client updates" value={f.communication.client_updates} hint={`${int(f.communication.parameters)} parameters each`} />
        <Stat label="Traffic" value={bytes(f.communication.total_upload_bytes + f.communication.total_download_bytes)} hint="up + down, float32" />
        <Stat label="Privacy" value={f.privacy.epsilon != null ? `ε ${eps(f.privacy.epsilon)}` : "None"} tone={f.privacy.epsilon != null ? "violet" : "amber"} hint={f.privacy.mode === "client_dp" ? "client-level" : f.privacy.mode === "local_dp_sgd" ? "example-level, per client" : "FedAvg alone"} />
      </div>
      {f.privacy.mode === "none" && (
        <Callout tone="amber" title="No formal privacy guarantee">
          Clients never upload raw records, but the model updates they send can still leak information about those records. Use client-level DP or local DP-SGD for a measurable guarantee.
        </Callout>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Global model across rounds">
          <Lines label="Global test accuracy and F1 per federated round" data={rounds} xKey="round" series={[{ key: "acc", name: "Accuracy", color: c.signal, dot: true }, { key: "f1", name: "F1", color: c.blue }]} yFmt={(v) => `${(v * 100).toFixed(0)}%`} refY={central ? { y: central.test.accuracy, label: "Centralized", color: c.muted } : undefined} />
        </Panel>
        {f.privacy.mode !== "none" ? (
          <Panel title="Privacy budget across rounds" subtitle={f.privacy.guarantee}>
            <Lines label="Epsilon per round" data={rounds} xKey="round" series={[{ key: "eps", name: "ε", color: c.violet }]} yFmt={(v) => v.toFixed(2)} />
          </Panel>
        ) : (
          <Panel title="Mean local training loss">
            <Lines label="Mean local loss across participating clients per round" data={rounds} xKey="round" series={[{ key: "loss", name: "Local loss", color: c.amber }]} yFmt={(v) => v.toFixed(3)} />
          </Panel>
        )}
      </div>
      <Panel title="Client participation" subtitle="Each cell is one round; filled cells mean the client trained and sent an update.">
        <ParticipationGrid f={f} />
      </Panel>
      <Panel title="Clients" subtitle="Accuracy of the final global model on each client's local data">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {f.clients.map((cl) => {
            const total = cl.label_distribution.reduce((a, b) => a + b, 0) || 1;
            return (
              <div key={cl.client} className="rounded-xl border border-line bg-bg-2 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium text-ink">Client {cl.client + 1}</span>
                  <span className="num text-xs text-muted">{int(cl.n)} rows</span>
                </div>
                <p className="num mt-2 text-xl font-semibold text-signal">{pct(cl.final_accuracy)}</p>
                <div className="mt-2 flex h-1.5 overflow-hidden rounded-full" role="img" aria-label={`Label mix ${cl.label_distribution.join(" / ")}`}>
                  {cl.label_distribution.map((v, i) => (
                    <span key={i} style={{ width: `${(100 * v) / total}%`, background: [c.blue, c.violet, c.amber, c.signal][i % 4] }} />
                  ))}
                </div>
                <p className="num mt-1.5 text-xs text-muted">
                  {cl.rounds_participated} rounds{cl.epsilon != null ? ` · ε ${eps(cl.epsilon)}` : ""}
                </p>
              </div>
            );
          })}
        </div>
      </Panel>
      <Panel title="Communication and privacy details">
        <div className="grid gap-6 md:grid-cols-2">
          <KV
            items={[
              ["Parameters per model", int(f.communication.parameters)],
              ["Bytes per model", bytes(f.communication.bytes_per_model)],
              ["Total upload", bytes(f.communication.total_upload_bytes)],
              ["Total download", bytes(f.communication.total_download_bytes)],
              ["Wall-clock time", secs(f.seconds)],
            ]}
          />
          <KV
            items={[
              ["Mode", f.privacy.mode],
              ["Guarantee", <span className="text-ink-2">{f.privacy.guarantee}</span>],
              ["ε", fx(f.privacy.epsilon, 4)],
              ["δ", f.privacy.delta?.toExponential(1) ?? "—"],
              ["Noise multiplier", fx(f.privacy.noise_multiplier, 3)],
              ["Clip norm", f.privacy.clip_norm ?? "—"],
              ["Client sampling", f.privacy.client_sampling],
            ]}
          />
        </div>
      </Panel>
    </div>
  );
}

function ParticipationGrid({ f }: { f: FedResult }) {
  return (
    <div className="scrollbar-thin overflow-x-auto" tabIndex={0} role="region" aria-label="Client participation grid">
      <table className="border-separate" style={{ borderSpacing: 3 }}>
        <thead>
          <tr>
            <th className="pr-2 text-left text-xs font-normal text-muted">Client</th>
            {f.rounds.map((r) => (
              <th key={r.round} className="num w-5 text-center text-[10px] font-normal text-muted">
                {r.round}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {f.clients.map((cl) => (
            <tr key={cl.client}>
              <th className="pr-2 text-left text-xs font-normal text-ink-2">{cl.client + 1}</th>
              {f.rounds.map((r) => {
                const on = r.participants.includes(cl.client);
                return (
                  <td key={r.round} title={`Client ${cl.client + 1}, round ${r.round}: ${on ? "participated" : "idle"}`}>
                    <span className={clsx("block size-5 rounded-[5px] border", on ? "border-signal/50 bg-signal/70" : "border-line bg-bg-2")}>
                      <span className="sr-only">{on ? "participated" : "idle"}</span>
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ================================================================== attack (D) */
const ATTACK_NAMES: Record<string, string> = { loss_threshold: "Loss threshold", entropy_threshold: "Entropy threshold", shadow_model: "Shadow models" };

export function AttackView({ r }: { r: Results }) {
  const c = useChartColors();
  const models = (r.models ?? []).filter((m) => m.attack);
  const palette = [c.rose, c.violet, c.indigo, c.blue, c.signal];
  const attackKeys = Object.keys(models[0]?.attack?.attacks ?? {});
  const aucData = attackKeys.map((k) => {
    const row: Record<string, unknown> = { attack: ATTACK_NAMES[k] ?? k };
    models.forEach((m, i) => (row[`m${i}`] = m.attack!.attacks[k].roc_auc));
    return row;
  });
  const prData = models.map((m) => {
    const best = Object.values(m.attack!.attacks).reduce((a, b) => ((b.roc_auc ?? 0) > (a.roc_auc ?? 0) ? b : a));
    return { model: m.label, precision: best.precision, recall: best.recall, advantage: Math.max(0, best.advantage) };
  });
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {models.map((m, i) => {
          const lk = m.leakage!;
          const tone = lk.leakage_level === "high" ? "rose" : lk.leakage_level === "moderate" ? "amber" : "signal";
          return (
            <div key={m.model_id} className="panel relative overflow-hidden p-4">
              <span className="absolute inset-y-0 left-0 w-1" style={{ background: palette[i % palette.length] }} aria-hidden />
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink">{m.label}</p>
                <Badge tone={tone} dot>
                  {lk.leakage_level} leakage
                </Badge>
              </div>
              <p className="num mt-3 text-[28px] font-semibold leading-none text-ink">{fx(m.attack!.best_attack_auc, 3)}</p>
              <p className="mt-1 text-xs text-muted">best attack AUC (0.5 = guessing)</p>
              <div className="num mt-3 grid grid-cols-2 gap-2 text-xs">
                <span className="text-muted">
                  Test acc <span className="text-ink">{pct(m.test.accuracy)}</span>
                </span>
                <span className="text-muted">
                  Gap <span className="text-ink">{(lk.generalization_gap * 100).toFixed(1)} pt</span>
                </span>
                <span className="text-muted">
                  ε <span className="text-violet">{m.privacy?.epsilon != null ? eps(m.privacy.epsilon) : "∞"}</span>
                </span>
                <span className="text-muted">
                  attack ε* <span className="text-ink">{fx(m.attack!.max_attack_implied_epsilon, 2)}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="ROC curves · best attack per target" subtitle="Evaluation half only; thresholds were fit on a disjoint calibration half.">
          <ROC
            label="Membership inference ROC curves"
            curves={models.map((m, i) => {
              const best = Object.values(m.attack!.attacks).reduce((a, b) => ((b.roc_auc ?? 0) > (a.roc_auc ?? 0) ? b : a));
              return { name: `${m.label} (AUC ${fx(best.roc_auc, 3)})`, color: palette[i % palette.length], points: best.roc };
            })}
          />
        </Panel>
        <Panel title="Attack AUC by technique">
          <Bars label="Attack AUC by technique and target model" data={aucData} xKey="attack" series={models.map((m, i) => ({ key: `m${i}`, name: m.label, color: palette[i % palette.length] }))} yDomain={[0, 1]} yFmt={(v) => v.toFixed(2)} height={300} />
        </Panel>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Precision, recall and advantage" subtitle="At the calibrated threshold of each target's strongest attack">
          <Bars label="Attack precision, recall and membership advantage" data={prData} xKey="model" series={[{ key: "precision", name: "Precision", color: c.indigo }, { key: "recall", name: "Recall", color: c.blue }, { key: "advantage", name: "Advantage (TPR−FPR)", color: c.rose }]} yDomain={[0, 1]} yFmt={(v) => v.toFixed(2)} />
        </Panel>
        <Panel title="Confidence on the true label" subtitle={`Members vs non-members · ${models[0]?.label}${models.length > 1 ? ` and ${models[models.length - 1].label}` : ""}`}>
          <ConfidenceHist models={[models[0], models[models.length - 1]].filter((m, i, a) => a.indexOf(m) === i)} />
        </Panel>
      </div>
      <Panel title="All attack metrics">
        <div className="scrollbar-thin overflow-x-auto" tabIndex={0} role="region" aria-label="All attack metrics">
          <table className="num w-full min-w-[860px] text-left text-[13px]">
            <thead className="text-muted">
              <tr className="border-b border-line">
                {["Target", "Attack", "AUC", "Accuracy", "Precision", "Recall", "Advantage", "TPR @1% FPR", "TPR @10% FPR", "Attack-implied ε*"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium first:pl-0">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {models.flatMap((m) =>
                Object.entries(m.attack!.attacks).map(([k, a]) => (
                  <tr key={m.model_id + k} className="border-b border-line/60 last:border-0">
                    <td className="py-2.5 pr-3 font-medium text-ink">{m.label}</td>
                    <td className="px-3 text-ink-2">{ATTACK_NAMES[k] ?? k}</td>
                    <td className="px-3">{fx(a.roc_auc, 3)}</td>
                    <td className="px-3">{pct(a.accuracy)}</td>
                    <td className="px-3">{pct(a.precision)}</td>
                    <td className="px-3">{pct(a.recall)}</td>
                    <td className="px-3">{fx(a.advantage, 3)}</td>
                    <td className="px-3">{pct(a.tpr_at_1pct_fpr)}</td>
                    <td className="px-3">{pct(a.tpr_at_10pct_fpr)}</td>
                    <td className="px-3">{fx(a.attack_implied_epsilon, 3)}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      {models.some((m) => m.attribute_inference) && (
        <Panel title={`Attribute inference · ${models.find((m) => m.attribute_inference)!.attribute_inference!.attribute}`} subtitle="Adversary knows every other feature and the label, and guesses the hidden attribute from model confidence.">
          <Bars
            label="Attribute inference accuracy versus majority-class baseline"
            data={models.filter((m) => m.attribute_inference).map((m) => ({ model: m.label, members: m.attribute_inference!.members.accuracy, non: m.attribute_inference!.non_members.accuracy, base: m.attribute_inference!.members.baseline }))}
            xKey="model"
            series={[{ key: "members", name: "On training members", color: c.rose }, { key: "non", name: "On non-members", color: c.blue }, { key: "base", name: "Majority baseline", color: c.muted }]}
            yDomain={[0, 1]}
            yFmt={(v) => `${Math.round(v * 100)}%`}
          />
        </Panel>
      )}
      <Callout tone="amber" title="How to read these results">
        {r.setup?.threat_model} Members: {r.setup?.members}; non-member pool: {r.setup?.non_member_pool}; shadow pool: {r.setup?.shadow_pool}. A weak attack does not prove a model is private. *Attack-implied ε is a heuristic computed from one training run (Clopper–Pearson on TPR/FPR); it is not a statistically valid DP audit and never an upper bound on leakage.
      </Callout>
    </div>
  );
}

function ConfidenceHist({ models }: { models: ModelResult[] }) {
  const c = useChartColors();
  const bins = models[0].attack!.confidence_hist.bins;
  const data = bins.slice(0, -1).map((b, i) => {
    const row: Record<string, unknown> = { bin: `${b.toFixed(2)}` };
    models.forEach((m, j) => {
      const h = m.attack!.confidence_hist;
      const tot = h.members.reduce((a, x) => a + x, 0) || 1;
      const totN = h.non_members.reduce((a, x) => a + x, 0) || 1;
      row[`in${j}`] = h.members[i] / tot;
      row[`out${j}`] = h.non_members[i] / totN;
    });
    return row;
  });
  const series = models.flatMap((m, j) => [
    { key: `in${j}`, name: `${m.label} · members`, color: j === 0 ? c.rose : c.violet },
    { key: `out${j}`, name: `${m.label} · non-members`, color: j === 0 ? c.blue : c.signal, dashed: true },
  ]);
  return <Lines label="Distribution of true-class confidence for members and non-members" data={data} xKey="bin" series={series} yFmt={(v) => `${(v * 100).toFixed(0)}%`} />;
}

/* ================================================================== PII (E) */
export function SampleCompare({ report, highlight }: { report: TransformReport; highlight?: string[] }) {
  const cols = report.columns_before;
  const changed = new Set(report.applied.map((a) => a.column));
  const cell = (r: Row, c: string) => {
    const v = r[c];
    return v == null ? <span className="text-muted">null</span> : String(v);
  };
  return (
    <div className="grid gap-4 2xl:grid-cols-2">
      {(["Before", "After"] as const).map((label) => {
        const rows = label === "Before" ? report.sample_before : report.sample_after;
        const show = label === "Before" ? cols : report.columns_after;
        return (
          <div key={label} className="min-w-0">
            <p className="mb-2 text-[13px] font-medium text-ink-2">{label}</p>
            <div className="scrollbar-thin overflow-x-auto rounded-lg border border-line" tabIndex={0} role="region" aria-label={`Sample rows ${label.toLowerCase()} protection`}>
              <table className="w-full text-left text-xs">
                <thead className="bg-bg-2 text-muted">
                  <tr>
                    {show.map((c) => (
                      <th key={c} className={clsx("whitespace-nowrap px-2.5 py-2 font-medium", changed.has(c) && "text-violet", highlight?.includes(c) && label === "Before" && "text-rose")}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t border-line/60">
                      {show.map((c) => (
                        <td key={c} className={clsx("max-w-[180px] truncate whitespace-nowrap px-2.5 py-1.5 font-mono", changed.has(c) ? (label === "After" ? "text-violet" : "text-ink") : "text-ink-2")}>
                          {cell(r, c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function KAnonCompare({ report }: { report: TransformReport }) {
  const c = useChartColors();
  const b = report.k_anonymity_before;
  const a = report.k_anonymity_after;
  const data = b.class_size_distribution.map((x, i) => ({ bucket: `k ${x.bucket}`, before: x.records, after: a.class_size_distribution[i]?.records ?? 0 }));
  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <div className="space-y-3">
        <KV
          items={[
            ["Quasi-identifiers", <span className="text-ink-2">{b.quasi_identifiers.join(", ") || "none"}</span>],
            ["k before → after", `${b.k ?? "—"} → ${a.k ?? "—"}`],
            ["Unique records", `${b.unique_pct}% → ${a.unique_pct}%`],
            ["Equivalence classes", `${int(b.classes)} → ${int(a.classes)}`],
          ]}
        />
        <p className="text-xs leading-relaxed text-muted">k is the size of the smallest group of records sharing the same quasi-identifier values. Records with k = 1 are unique and easiest to re-identify.</p>
      </div>
      <Bars label="Records by equivalence class size before and after protection" data={data} xKey="bucket" series={[{ key: "before", name: "Before", color: c.rose }, { key: "after", name: "After", color: c.signal }]} height={220} />
    </div>
  );
}

export function PiiView({ r }: { r: Results }) {
  const sb = r.scan_before!.summary;
  const sa = r.scan_after!.summary;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Risk score" value={`${sb.risk_score} → ${sa.risk_score}`} tone={sa.risk_score < sb.risk_score ? "signal" : "amber"} hint="heuristic, 0–100" />
        <Stat label="Direct identifiers" value={`${sb.direct_identifiers.length} → ${sa.direct_identifiers.length}`} tone="violet" />
        <Stat label="Unique on quasi-identifiers" value={`${r.transform!.k_anonymity_before.unique_pct}% → ${r.transform!.k_anonymity_after.unique_pct}%`} />
        <Stat label="Utility change" value={r.utility ? `${(r.utility.accuracy_change * 100).toFixed(2)} pt` : "—"} tone={r.utility && r.utility.accuracy_change < -0.02 ? "amber" : "signal"} hint={r.utility ? `${pct(r.utility.original.test.accuracy)} → ${pct(r.utility.protected.test.accuracy)}` : "not measured"} />
      </div>
      <Panel title="Applied protections">
        <div className="flex flex-wrap gap-2">
          {r.transform!.applied.map((a) => (
            <Badge key={a.column} tone={a.action === "suppress" ? "rose" : a.action === "generalize" ? "amber" : "violet"}>
              {a.column}: {a.action} · {a.changed_pct}% changed
            </Badge>
          ))}
        </div>
      </Panel>
      <Panel title="Before and after">
        <SampleCompare report={r.transform!} highlight={sb.direct_identifiers} />
      </Panel>
      <Panel title="Re-identification risk (k-anonymity)">
        <KAnonCompare report={r.transform!} />
      </Panel>
      {r.utility && (
        <Panel title="Effect on model utility">
          <MetricsTable models={[r.utility.original, r.utility.protected]} />
        </Panel>
      )}
      <Callout tone="amber">Masking, suppression and generalisation reduce exposure but do not make data anonymous. Only the local-DP action gives a formal guarantee, and only for the columns it was applied to.</Callout>
    </div>
  );
}

export function ExperimentResults({ exp }: { exp: Experiment }) {
  const r = exp.results;
  if (!r) return null;
  switch (exp.type) {
    case "budget_sweep":
      return <SweepView r={r} />;
    case "federated":
      return <FederatedView r={r} />;
    case "attack":
      return <AttackView r={r} />;
    case "pii":
      return <PiiView r={r} />;
    default:
      return <TrainingView r={r} />;
  }
}
