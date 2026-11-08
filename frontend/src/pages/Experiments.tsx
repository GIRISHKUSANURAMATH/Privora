import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, HardDriveDownload, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/Layout";
import { DatasetPicker, ExpRow, ModelParamsForm, ReportButton, RunButton, RunStatus, type DataChoice, type ModelParams } from "../components/shared";
import { Button, Confirm, Empty, ErrorNote, KV, Panel, Select, Spinner, Tabs, useToast } from "../components/ui";
import { ExperimentResults } from "../components/views";
import { api, type Experiment } from "../lib/api";
import { eps, fx, pct, secs, TYPE_LABEL } from "../lib/format";
import { useExperiment, useRunner } from "../lib/hooks";

export default function Experiments() {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<string>("all");
  const [showNew, setShowNew] = useState(false);
  const list = useQuery({ queryKey: ["experiments"], queryFn: () => api.experiments(), refetchInterval: 4000 });
  const selected = params.get("id") ?? list.data?.[0]?.id ?? null;
  const items = (list.data ?? []).filter((e) => filter === "all" || e.type === filter);
  const counts = (list.data ?? []).reduce<Record<string, number>>((a, e) => ((a[e.type] = (a[e.type] ?? 0) + 1), a), {});

  return (
    <div>
      <PageHeader
        icon={<FlaskConical className="size-5" />}
        title="Model Experiments"
        description="Every run, its configuration, its stored results and the model artifacts it saved. Train a conventional baseline here; private and federated runs start in their own studios."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setShowNew((s) => !s)}>
            Conventional run
          </Button>
        }
      />
      {showNew && <NewBaseline onStarted={(id) => { setParams({ id }); setShowNew(false); }} />}
      <Tabs value={filter} onChange={setFilter} tabs={[{ value: "all", label: "All", count: list.data?.length }, ...Object.keys(TYPE_LABEL).filter((k) => counts[k]).map((k) => ({ value: k, label: TYPE_LABEL[k], count: counts[k] }))]} />
      <div className="mt-6 grid gap-6 xl:grid-cols-[340px_1fr]">
        <Panel bodyClass="p-2" className="self-start">
          {list.isLoading && <Spinner />}
          {list.error && <ErrorNote error={list.error} />}
          {items.length === 0 && !list.isLoading && <Empty icon={<FlaskConical className="size-5" />} title="No experiments" body="Start a run from any studio, or train a conventional baseline with the button above." />}
          <div className="scrollbar-thin max-h-[70vh] space-y-0.5 overflow-y-auto" tabIndex={0} role="region" aria-label="Experiment list">
            {items.map((e) => (
              <ExpRow key={e.id} e={e} active={e.id === selected} onClick={() => setParams({ id: e.id })} />
            ))}
          </div>
        </Panel>
        <div className="min-w-0">{selected ? <Detail id={selected} onDeleted={() => setParams({})} /> : null}</div>
      </div>
      <SavedModels />
    </div>
  );
}

function NewBaseline({ onStarted }: { onStarted: (id: string) => void }) {
  const [data, setData] = useState<DataChoice | null>(null);
  const [model, setModel] = useState<ModelParams>({ hidden: [64, 32], epochs: 20, batch_size: 64, lr: 0.002, optimizer: "adam", seed: 42 });
  const r = useRunner("run-baseline");
  return (
    <Panel title="New conventional training run" subtitle="No privacy mechanism. Use it as the reference point for private models." className="mb-6">
      <div className="space-y-5">
        <DatasetPicker value={data} onChange={setData} />
        <ModelParamsForm value={model} onChange={setModel} />
        <RunButton
          loading={r.submit.isPending}
          disabled={!data?.target}
          onClick={() =>
            r.submit.mutate(
              { type: "baseline", name: `Conventional · ${model.hidden.join("×")} · ${model.epochs} epochs`, data: { dataset_id: data!.dataset_id, target: data!.target }, model },
              { onSuccess: (e) => onStarted(e.id) },
            )
          }
        >
          Train
        </RunButton>
      </div>
    </Panel>
  );
}

function Detail({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const q = useExperiment(id);
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const del = useMutation({
    mutationFn: () => api.deleteExperiment(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["experiments"] });
      toast({ tone: "success", title: "Experiment deleted" });
      onDeleted();
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't delete", body: (e as Error).message }),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;
  const e = q.data as Experiment;
  const cfg = e.config as { model?: Record<string, unknown>; data?: Record<string, unknown>; dp?: Record<string, unknown> | null; federated?: Record<string, unknown> | null; attack?: Record<string, unknown> | null; sweep?: Record<string, unknown> | null };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-ink">{e.name}</h2>
          <p className="text-[13px] text-muted">
            {TYPE_LABEL[e.type]} · {new Date(e.created_at).toLocaleString()} · {secs(e.duration_s)}
          </p>
        </div>
        <div className="flex gap-2">
          <ReportButton exp={e} />
          <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirm(true)} disabled={e.status === "running" || e.status === "queued"}>
            Delete
          </Button>
        </div>
      </div>
      <Confirm open={confirm} danger title="Delete this experiment?" body="Its stored results are removed. Saved model files stay on disk." confirmLabel="Delete experiment" onConfirm={() => del.mutate()} onClose={() => setConfirm(false)} />
      <RunStatus exp={e} hideOpen />
      <Panel title="Configuration">
        <div className="grid gap-6 md:grid-cols-2">
          {cfg.data && <KV items={Object.entries(cfg.data).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length)).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)])} />}
          <KV items={Object.entries({ ...(cfg.model ?? {}), ...(cfg.dp ?? {}), ...(cfg.federated ?? {}), ...(cfg.attack ?? {}), ...(cfg.sweep ?? {}) }).filter(([, v]) => v != null).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)])} />
        </div>
      </Panel>
      {e.status === "completed" && <ExperimentResults exp={e} />}
    </div>
  );
}

function SavedModels() {
  const models = useQuery({ queryKey: ["models"], queryFn: api.models });
  const ds = useQuery({ queryKey: ["datasets"], queryFn: api.datasets });
  const [dsId, setDsId] = useState<string>("");
  const [result, setResult] = useState<Record<string, { acc: number; f1: number } | string>>({});
  const toast = useToast();
  const evalM = useMutation({
    mutationFn: (mid: string) => api.evaluateModel(mid, dsId || ds.data![0].id),
    onSuccess: (r) => {
      setResult((x) => ({ ...x, [r.model_id]: { acc: r.metrics.accuracy, f1: r.metrics.f1 } }));
      toast({ tone: "success", title: "Model reloaded from disk", body: `Weights loaded with weights_only=True; accuracy ${pct(r.metrics.accuracy)} on the full dataset.` });
    },
    onError: (e, mid) => setResult((x) => ({ ...x, [mid]: (e as Error).message })),
  });
  if (!models.data?.length) return null;
  return (
    <Panel
      className="mt-8"
      title="Saved model artifacts"
      subtitle="state_dict weights plus JSON architecture and encoder. Reload re-reads them from disk and re-evaluates."
      actions={ds.data?.length ? <div className="w-64"><Select ariaLabel="Dataset for evaluation" value={dsId || ds.data[0].id} onChange={setDsId} options={ds.data.map((d) => ({ value: d.id, label: d.name }))} /></div> : undefined}
      bodyClass="p-0"
    >
      <div className="scrollbar-thin max-h-[420px] overflow-auto" tabIndex={0} role="region" aria-label="Saved model artifacts">
        <table className="num w-full min-w-[760px] text-left text-[13px]">
          <thead className="sticky top-0 bg-surface text-muted">
            <tr className="border-b border-line">
              {["Model", "Kind", "Test accuracy", "F1", "ε", "Saved", "Reload check"].map((h) => (
                <th key={h} className="px-4 py-2.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {models.data.map((m) => {
              const r = result[m.id];
              return (
                <tr key={m.id} className="border-b border-line/50">
                  <td className="px-4 py-2 text-ink">{m.label}</td>
                  <td className="px-4 text-ink-2">{m.kind}</td>
                  <td className="px-4">{pct(m.metrics.accuracy)}</td>
                  <td className="px-4">{fx(m.metrics.f1, 3)}</td>
                  <td className="px-4 text-violet">{m.privacy?.epsilon != null ? eps(m.privacy.epsilon) : "—"}</td>
                  <td className="px-4 text-muted">{new Date(m.created_at).toLocaleString()}</td>
                  <td className="px-4 py-1.5">
                    {r ? (
                      typeof r === "string" ? <span className="text-xs text-rose">{r}</span> : <span className="text-xs text-signal">acc {pct(r.acc)} · F1 {fx(r.f1, 3)}</span>
                    ) : (
                      <Button size="sm" variant="ghost" icon={<HardDriveDownload className="size-3.5" />} loading={evalM.isPending && evalM.variables === m.id} onClick={() => evalM.mutate(m.id)}>
                        Reload & evaluate
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
