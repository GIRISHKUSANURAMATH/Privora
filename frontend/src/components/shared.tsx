import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Database, Download, FileText, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, type Experiment, type ModelResult } from "../lib/api";
import { ago, eps, epsBand, fx, int, pct, secs, TYPE_LABEL } from "../lib/format";
import { useChartColors } from "../lib/theme";
import { Bars, Lines } from "./charts";
import { Badge, Button, Callout, Empty, ErrorNote, Field, KV, NumberInput, Panel, Progress, Segmented, Select, StatusBadge, useToast } from "./ui";

/* ------------------------------------------------------------------ dataset + target picker */
export interface DataChoice {
  dataset_id: string;
  target: string;
}

export function useDatasets() {
  return useQuery({ queryKey: ["datasets"], queryFn: api.datasets });
}

export function DatasetPicker({ value, onChange, requireTarget = true }: { value: DataChoice | null; onChange: (v: DataChoice) => void; requireTarget?: boolean }) {
  const ds = useDatasets();
  const detail = useQuery({ queryKey: ["dataset", value?.dataset_id], queryFn: () => api.dataset(value!.dataset_id), enabled: !!value?.dataset_id });
  useEffect(() => {
    if (!value && ds.data?.length) {
      const d = ds.data.find((x) => x.source === "synthetic") ?? ds.data[0];
      onChange({ dataset_id: d.id, target: d.target_hint ?? "" });
    }
  }, [ds.data, value, onChange]);

  if (ds.isLoading) return <p className="text-sm text-muted">Loading datasets…</p>;
  if (ds.error) return <ErrorNote error={ds.error} onRetry={() => ds.refetch()} />;
  if (!ds.data?.length)
    return (
      <Empty
        icon={<Database className="size-5" />}
        title="No datasets yet"
        body="Generate a synthetic dataset or upload a CSV in the Dataset Studio first."
        action={
          <Link to="/datasets">
            <Button variant="primary">Open Dataset Studio</Button>
          </Link>
        }
      />
    );
  const cols = detail.data?.profile.column_stats.map((c) => c.name) ?? [];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Dataset" htmlFor="ds-pick">
        <Select
          id="ds-pick"
          value={value?.dataset_id ?? ""}
          onChange={(id) => {
            const d = ds.data!.find((x) => x.id === id)!;
            onChange({ dataset_id: id, target: d.target_hint ?? "" });
          }}
          options={ds.data.map((d) => ({ value: d.id, label: `${d.name} (${int(d.rows)})` }))}
        />
      </Field>
      {requireTarget && (
        <Field label="Target column" htmlFor="tgt-pick" hint="The label the model learns to predict.">
          <Select id="tgt-pick" value={value?.target ?? ""} onChange={(t) => value && onChange({ ...value, target: t })} options={cols.length ? cols.map((c) => ({ value: c, label: c })) : [{ value: value?.target ?? "", label: value?.target || "…" }]} />
        </Field>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ model hyper-parameters */
export interface ModelParams {
  hidden: number[];
  epochs: number;
  batch_size: number;
  lr: number;
  optimizer: "adam" | "sgd";
  seed: number;
  weight_decay?: number;
}

export function ModelParamsForm({ value, onChange, compact }: { value: ModelParams; onChange: (v: ModelParams) => void; compact?: boolean }) {
  const set = <K extends keyof ModelParams>(k: K, v: ModelParams[K]) => onChange({ ...value, [k]: v });
  return (
    <div className={compact ? "grid grid-cols-2 gap-4" : "grid grid-cols-2 gap-4 md:grid-cols-3"}>
      <Field label="Hidden layers" htmlFor="mp-hidden" hint="Comma-separated widths">
        <input
          id="mp-hidden"
          defaultValue={value.hidden.join(", ")}
          onBlur={(e) => {
            const h = e.target.value
              .split(",")
              .map((x) => parseInt(x.trim(), 10))
              .filter((x) => x >= 2 && x <= 1024);
            if (h.length) set("hidden", h.slice(0, 5));
          }}
          className="h-10 w-full rounded-lg border border-line-strong bg-bg-2 px-3 text-sm text-ink outline-none focus:border-indigo focus:ring-2 focus:ring-indigo/30"
        />
      </Field>
      <Field label="Epochs" htmlFor="mp-ep">
        <NumberInput id="mp-ep" value={value.epochs} min={1} max={300} onChange={(v) => set("epochs", Math.round(v))} />
      </Field>
      <Field label="Batch size" htmlFor="mp-bs">
        <NumberInput id="mp-bs" value={value.batch_size} min={4} max={4096} onChange={(v) => set("batch_size", Math.round(v))} />
      </Field>
      <Field label="Learning rate" htmlFor="mp-lr">
        <NumberInput id="mp-lr" value={value.lr} min={0.00001} max={5} step={0.0005} onChange={(v) => set("lr", v)} />
      </Field>
      <Field label="Optimizer" htmlFor="mp-opt">
        <Select id="mp-opt" value={value.optimizer} onChange={(v) => set("optimizer", v as "adam")} options={[{ value: "adam", label: "Adam" }, { value: "sgd", label: "SGD + momentum" }]} />
      </Field>
      <Field label="Random seed" htmlFor="mp-seed">
        <NumberInput id="mp-seed" value={value.seed} min={0} max={2147483647} onChange={(v) => set("seed", Math.round(v))} />
      </Field>
    </div>
  );
}

/* ------------------------------------------------------------------ run status */
export function RunStatus({ exp, onReset, hideOpen }: { exp: Experiment; onReset?: () => void; hideOpen?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const cancel = useMutation({
    mutationFn: () => api.cancel(exp.id),
    onSuccess: () => {
      toast({ tone: "info", title: "Cancellation requested", body: "The job stops at the end of the current epoch or round." });
      qc.invalidateQueries({ queryKey: ["experiment", exp.id] });
    },
  });
  const active = exp.status === "running" || exp.status === "queued";
  const live = exp.live ?? {};
  return (
    <div className="panel p-4" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={exp.status} />
        <p className="min-w-0 flex-1 truncate text-sm text-ink">
          <span className="font-medium">{exp.name}</span>
          <span className="text-muted"> · {exp.message}</span>
        </p>
        {active ? (
          <Button size="sm" variant="ghost" icon={<Ban className="size-3.5" />} loading={cancel.isPending} onClick={() => cancel.mutate()}>
            Cancel
          </Button>
        ) : (
          <>
            {!hideOpen && (
              <Link to={`/experiments?id=${exp.id}`}>
                <Button size="sm" variant="ghost">
                  Open in Experiments
                </Button>
              </Link>
            )}
            {onReset && (
              <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={onReset}>
                New run
              </Button>
            )}
          </>
        )}
      </div>
      {active && (
        <div className="mt-3 space-y-2">
          <Progress value={exp.progress} label="Experiment progress" />
          <div className="num flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
            <span>{Math.round(exp.progress * 100)}%</span>
            {live.epoch != null && <span>epoch {live.epoch}</span>}
            {live.round != null && <span>round {live.round}</span>}
            {live.loss != null && <span>loss {fx(live.loss, 4)}</span>}
            {live.accuracy != null && <span>test accuracy {pct(live.accuracy)}</span>}
            {live.epsilon != null && <span className="text-violet">ε spent {fx(live.epsilon, 3)}</span>}
          </div>
        </div>
      )}
      {exp.status === "failed" && exp.error && (
        <div className="mt-3">
          <ErrorNote error={new Error(exp.error)} />
          <p className="mt-2 text-xs text-muted">Adjust the configuration (for example δ must be below 1/n, Dirichlet partitions need enough rows per client) and run again.</p>
        </div>
      )}
    </div>
  );
}

export function RunButton({ onClick, loading, disabled, children = "Run experiment" }: { onClick: () => void; loading?: boolean; disabled?: boolean; children?: ReactNode }) {
  return (
    <Button variant="primary" icon={<Play className="size-4" />} onClick={onClick} loading={loading} disabled={disabled}>
      {children}
    </Button>
  );
}

/* ------------------------------------------------------------------ metrics */
export function MetricsTable({ models }: { models: ModelResult[] }) {
  return (
    <div className="scrollbar-thin relative overflow-x-auto" tabIndex={0} role="region" aria-label="Model metrics table">
      <table className="w-full min-w-[720px] text-left text-[13px]">
        <caption className="sr-only">Held-out test metrics per model</caption>
        <thead>
          <tr className="border-b border-line text-muted">
            {["Model", "Accuracy", "Precision", "Recall", "F1", "ROC-AUC", "ε (δ)", "Train time"].map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium first:pl-0">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="num">
          {models.map((m) => {
            const band = epsBand(m.privacy?.epsilon);
            return (
              <tr key={m.model_id} className="border-b border-line/60 last:border-0">
                <th scope="row" className="py-2.5 pr-3 font-medium text-ink">
                  <span className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${m.kind === "dp" ? "bg-violet" : m.kind === "federated" ? "bg-signal" : "bg-blue"}`} aria-hidden />
                    {m.label}
                  </span>
                </th>
                <td className="px-3">{pct(m.test.accuracy, 2)}</td>
                <td className="px-3">{pct(m.test.precision, 2)}</td>
                <td className="px-3">{pct(m.test.recall, 2)}</td>
                <td className="px-3">{fx(m.test.f1, 4)}</td>
                <td className="px-3">{fx(m.test.roc_auc, 4)}</td>
                <td className="px-3">
                  {m.privacy?.epsilon != null ? (
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <span className="text-violet">{eps(m.privacy.epsilon)}</span>
                      <span className="text-muted">({m.privacy.delta?.toExponential(0)})</span>
                      <Badge tone={band.tone === "muted" ? "muted" : band.tone}>{band.label}</Badge>
                    </span>
                  ) : (
                    <span className="text-muted">none</span>
                  )}
                </td>
                <td className="px-3">{secs(m.train_seconds)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MetricBars({ models, height = 240 }: { models: ModelResult[]; height?: number }) {
  const c = useChartColors();
  const palette = [c.blue, c.violet, c.indigo, c.signal, c.amber, c.rose];
  const keys = ["accuracy", "precision", "recall", "f1"] as const;
  const data = keys.map((k) => {
    const row: Record<string, unknown> = { metric: k === "f1" ? "F1" : k[0].toUpperCase() + k.slice(1) };
    models.forEach((m, i) => (row[`m${i}`] = m.test[k]));
    return row;
  });
  return <Bars label="Precision, recall, F1 and accuracy by model" data={data} xKey="metric" height={height} yDomain={[0, 1]} yFmt={(v) => `${Math.round(v * 100)}%`} series={models.map((m, i) => ({ key: `m${i}`, name: m.label, color: palette[i % palette.length] }))} />;
}

export function TrainingCurves({ models }: { models: ModelResult[] }) {
  const c = useChartColors();
  const palette = [c.blue, c.violet, c.indigo, c.signal, c.amber, c.rose];
  const withHist = models.filter((m) => m.history?.epoch.length);
  if (!withHist.length) return null;
  const maxEp = Math.max(...withHist.map((m) => m.history!.epoch.length));
  const data = Array.from({ length: maxEp }, (_, i) => {
    const r: Record<string, unknown> = { epoch: i + 1 };
    withHist.forEach((m, j) => {
      r[`a${j}`] = m.history!.test_accuracy[i] ?? null;
      r[`l${j}`] = m.history!.train_loss[i] ?? null;
    });
    return r;
  });
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div>
        <p className="mb-2 text-[13px] font-medium text-ink-2">Test accuracy per epoch</p>
        <Lines label="Test accuracy per epoch" data={data} xKey="epoch" yFmt={(v) => `${(v * 100).toFixed(0)}%`} series={withHist.map((m, j) => ({ key: `a${j}`, name: m.label, color: palette[j % palette.length] }))} />
      </div>
      <div>
        <p className="mb-2 text-[13px] font-medium text-ink-2">Training loss per epoch</p>
        <Lines label="Training loss per epoch" data={data} xKey="epoch" yFmt={(v) => v.toFixed(2)} series={withHist.map((m, j) => ({ key: `l${j}`, name: m.label, color: palette[j % palette.length] }))} />
      </div>
    </div>
  );
}

export function PrivacyLedger({ m }: { m: ModelResult }) {
  const p = m.privacy;
  if (!p) return null;
  return (
    <div className="space-y-3">
      <KV
        items={[
          ["Guarantee", <span className="text-ink-2">{p.guarantee}</span>],
          ["ε spent", <span className="font-semibold text-violet">{fx(p.epsilon, 4)}</span>],
          ["δ", p.delta?.toExponential(1)],
          ...(p.target_epsilon != null ? [["Target ε", fx(p.target_epsilon, 2)] as [ReactNode, ReactNode]] : []),
          ["Noise multiplier σ", fx(p.noise_multiplier, 4)],
          ...(p.max_grad_norm != null ? [["Clipping norm C", p.max_grad_norm] as [ReactNode, ReactNode]] : []),
          ...(p.noise_std != null ? [["Noise std σ·C", fx(p.noise_std, 4)] as [ReactNode, ReactNode]] : []),
          ...(p.sample_rate != null ? [["Sampling rate q", fx(p.sample_rate, 5)] as [ReactNode, ReactNode]] : []),
          ...(p.steps != null ? [["Steps (compositions)", int(p.steps)] as [ReactNode, ReactNode]] : []),
          ...(p.sampling ? [["Sampling", p.sampling] as [ReactNode, ReactNode]] : []),
          ...(p.accountant_info ? [["Accountant", p.accountant_info.name] as [ReactNode, ReactNode]] : []),
        ]}
      />
      {p.assumptions && (
        <Callout tone="violet" title="What this guarantee assumes">
          <ul className="list-disc space-y-1 pl-4">
            {p.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Callout>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ report button */
export function ReportButton({ exp }: { exp: Experiment }) {
  const toast = useToast();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api.createReport(exp.id),
    onSuccess: (r) => {
      toast({ tone: "success", title: "Report generated", body: "Find it under Reports, or download it now." });
      qc.invalidateQueries({ queryKey: ["reports"] });
      window.open(api.reportUrl(r.id, "html"), "_blank", "noopener");
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't generate the report", body: (e as Error).message }),
  });
  return (
    <Button size="sm" icon={<FileText className="size-3.5" />} loading={m.isPending} disabled={exp.status !== "completed"} onClick={() => m.mutate()}>
      Generate report
    </Button>
  );
}

export function DownloadLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="inline-flex h-8 items-center gap-2 rounded-lg border border-line-strong bg-raised px-3 text-[13px] font-medium text-ink hover:border-indigo/60" download>
      <Download className="size-3.5" aria-hidden />
      {children}
    </a>
  );
}

/* ------------------------------------------------------------------ experiment list row */
export function ExpRow({ e, onClick, active }: { e: Experiment; onClick?: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${active ? "bg-indigo/10 ring-1 ring-indigo/40" : "hover:bg-raised"}`}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{e.name}</p>
        <p className="mt-0.5 text-xs text-muted">
          {TYPE_LABEL[e.type]} · {ago(e.created_at)}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <StatusBadge status={e.status} />
        {e.headline?.accuracy != null && <span className="num text-xs text-ink-2">{pct(e.headline.accuracy)}</span>}
      </div>
    </button>
  );
}

export function useModeSwitch<T extends string>(opts: { value: T; label: string }[], v: T, set: (v: T) => void, label: string) {
  return useMemo(() => <Segmented ariaLabel={label} value={v} onChange={set} options={opts} />, [opts, v, set, label]);
}

export { Panel };
