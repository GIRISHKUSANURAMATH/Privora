import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, Database, Download, FileUp, ShieldAlert, Sparkles, Trash2, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bars } from "../components/charts";
import { PageHeader } from "../components/Layout";
import { useDatasets } from "../components/shared";
import { Badge, Button, Confirm, Empty, ErrorNote, NumberInput, Panel, Select, Spinner, Stat, useToast } from "../components/ui";
import { api, type ColumnStat, type Finding } from "../lib/api";
import { ago, int } from "../lib/format";
import { useChartColors } from "../lib/theme";

export default function DatasetStudio() {
  const ds = useDatasets();
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    if (!sel && ds.data?.length) setSel(ds.data[0].id);
    if (sel && ds.data && !ds.data.find((d) => d.id === sel)) setSel(ds.data[0]?.id ?? null);
  }, [ds.data, sel]);

  return (
    <div>
      <PageHeader icon={<Database className="size-5" />} title="Dataset Studio" description="Bring data in, check its quality and see which columns are sensitive before anything is trained on it." />
      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <div className="space-y-6">
          <Ingest onCreated={setSel} />
          <Panel title="Datasets" subtitle={ds.data ? `${ds.data.length} stored locally` : undefined} bodyClass="p-2">
            {ds.isLoading && <Spinner />}
            {ds.error && <ErrorNote error={ds.error} />}
            {ds.data?.length === 0 && <p className="p-3 text-sm text-muted">Nothing here yet.</p>}
            <ul className="space-y-0.5">
              {ds.data?.map((d) => (
                <li key={d.id}>
                  <button onClick={() => setSel(d.id)} aria-current={sel === d.id} className={clsx("w-full rounded-lg px-3 py-2.5 text-left transition-colors", sel === d.id ? "bg-indigo/10 ring-1 ring-indigo/40" : "hover:bg-raised")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink">{d.name}</span>
                      <Badge tone={d.source === "synthetic" ? "indigo" : d.source === "derived" ? "violet" : "blue"}>{d.source}</Badge>
                    </div>
                    <p className="num mt-0.5 text-xs text-muted">
                      {int(d.rows)} rows · {d.columns} columns · {ago(d.created_at)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <div className="min-w-0">{sel ? <DatasetDetail id={sel} /> : <Panel><Empty icon={<Database className="size-5" />} title="Pick or create a dataset" body="Synthetic datasets contain only fictional people, so they are safe to experiment with." /></Panel>}</div>
      </div>
    </div>
  );
}

function Ingest({ onCreated }: { onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const cat = useQuery({ queryKey: ["catalog"], queryFn: api.catalog });
  const [key, setKey] = useState("patients");
  const [n, setN] = useState(4000);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const gen = useMutation({
    mutationFn: () => api.synthetic(key, n),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["datasets"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onCreated(d.id);
      toast({ tone: "success", title: `${d.name} created`, body: `${int(d.rows)} rows (includes a few injected duplicates and missing values).` });
    },
    onError: (e) => toast({ tone: "error", title: "Generation failed", body: (e as Error).message }),
  });
  const up = useMutation({
    mutationFn: (f: File) => api.upload(f),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["datasets"] });
      onCreated(d.id);
      toast({ tone: "success", title: "Upload validated and stored", body: `${d.name}: ${int(d.rows)} rows, ${d.columns} columns.` });
    },
    onError: (e) => toast({ tone: "error", title: "Upload rejected", body: (e as Error).message }),
  });
  const handle = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!/\.(csv|tsv|txt)$/i.test(f.name)) {
      toast({ tone: "error", title: "Unsupported file", body: "Use a .csv, .tsv or .txt file with a header row." });
      return;
    }
    up.mutate(f);
  };
  const spec = cat.data?.find((c) => c.key === key);
  return (
    <Panel title="Add data">
      <div className="space-y-4">
        <div className="space-y-3 rounded-xl border border-line bg-bg-2 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <Sparkles className="size-4 text-indigo" aria-hidden /> Synthetic dataset
          </div>
          <Select ariaLabel="Synthetic dataset type" value={key} onChange={setKey} options={(cat.data ?? []).map((c) => ({ value: c.key, label: c.title }))} />
          {spec && <p className="text-xs leading-relaxed text-muted">{spec.description}</p>}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label htmlFor="syn-n" className="mb-1 block text-xs text-muted">
                Rows
              </label>
              <NumberInput id="syn-n" value={n} min={200} max={100000} onChange={(v) => setN(Math.round(v))} />
            </div>
            <Button variant="primary" loading={gen.isPending} onClick={() => gen.mutate()}>
              Generate
            </Button>
          </div>
        </div>
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            handle(e.dataTransfer.files);
          }}
          className={clsx("flex cursor-pointer flex-col items-center rounded-xl border border-dashed px-4 py-7 text-center transition-colors", drag ? "border-indigo bg-indigo/10" : "border-line-strong hover:border-indigo/60 hover:bg-raised")}
        >
          {up.isPending ? <Spinner label="Validating upload" /> : <UploadCloud className="size-7 text-indigo" aria-hidden />}
          <p className="mt-2 text-sm font-medium text-ink">Drop a CSV here, or browse</p>
          <p className="mt-1 text-xs text-muted">UTF-8 · .csv .tsv .txt · stays on this machine</p>
          <input ref={input} type="file" accept=".csv,.tsv,.txt,text/csv" className="hidden" onChange={(e) => handle(e.target.files)} />
        </div>
      </div>
    </Panel>
  );
}

const CAT_TONE: Record<Finding["category"], "rose" | "amber" | "violet" | "muted"> = { direct_identifier: "rose", quasi_identifier: "amber", sensitive_attribute: "violet", non_sensitive: "muted" };
const CAT_LABEL: Record<Finding["category"], string> = { direct_identifier: "Direct identifier", quasi_identifier: "Quasi-identifier", sensitive_attribute: "Sensitive", non_sensitive: "—" };

function DatasetDetail({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["dataset", id], queryFn: () => api.dataset(id) });
  const pii = useQuery({ queryKey: ["pii", id], queryFn: () => api.pii(id) });
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const c = useChartColors();
  const [col, setCol] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const del = useMutation({
    mutationFn: () => api.deleteDataset(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["datasets"] });
      toast({ tone: "success", title: "Dataset deleted" });
    },
  });
  if (q.isLoading) return <Spinner label="Profiling dataset" />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const p = d.profile;
  const findings = new Map((pii.data?.findings ?? []).map((f) => [f.column, f]));
  const active = p.column_stats.find((s) => s.name === col) ?? p.column_stats.find((s) => s.kind === "numeric") ?? p.column_stats[0];
  const missing = p.column_stats.filter((s) => s.missing > 0).map((s) => ({ col: s.name, pct: s.missing_pct }));

  return (
    <div className="space-y-6">
      <div className="panel flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-ink">{d.name}</h2>
          <p className="text-[13px] text-muted">
            {d.description || "No description"} · target: <span className="text-ink-2">{d.target_hint ?? "not set"}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<ShieldAlert className="size-3.5" />} onClick={() => nav(`/inspector?ds=${id}`)}>
            Inspect privacy
          </Button>
          <a href={api.exportUrl(id)} download className="inline-flex h-8 items-center gap-2 rounded-lg border border-line-strong bg-raised px-3 text-[13px] font-medium text-ink hover:border-indigo/60">
            <Download className="size-3.5" aria-hidden /> Export CSV
          </a>
          <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirm(true)}>
            Delete
          </Button>
        </div>
      </div>
      <Confirm open={confirm} danger title="Delete this dataset?" body={<>The file and its metadata are removed from this machine. Experiments that used it keep their stored results.</>} confirmLabel="Delete dataset" onConfirm={() => del.mutate()} onClose={() => setConfirm(false)} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Rows" value={int(p.rows)} />
        <Stat label="Columns" value={p.columns} />
        <Stat label="Quality score" value={p.quality.score} tone={p.quality.score > 90 ? "signal" : "amber"} hint="completeness, uniqueness, validity" />
        <Stat label="Missing cells" value={int(p.missing_cells)} tone={p.missing_cells ? "amber" : "signal"} />
        <Stat label="Duplicate rows" value={int(p.duplicate_rows)} tone={p.duplicate_rows ? "amber" : "signal"} />
      </div>

      <div className="grid gap-6 2xl:grid-cols-[1.3fr_1fr]">
        <Panel title="Columns" subtitle="Select a column to see its distribution" bodyClass="p-0">
          <div className="scrollbar-thin max-h-[440px] overflow-auto" tabIndex={0} role="region" aria-label="Column statistics">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className="sticky top-0 bg-surface text-muted">
                <tr className="border-b border-line">
                  {["Column", "Type", "Missing", "Unique", "Sensitivity"].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="num">
                {p.column_stats.map((s) => {
                  const f = findings.get(s.name);
                  return (
                    <tr key={s.name} onClick={() => setCol(s.name)} className={clsx("cursor-pointer border-b border-line/50 transition-colors", active?.name === s.name ? "bg-indigo/8" : "hover:bg-raised")}>
                      <td className="px-4 py-2">
                        <button className="font-medium text-ink" onClick={() => setCol(s.name)}>
                          {s.name}
                        </button>
                      </td>
                      <td className="px-4 text-ink-2">{s.kind}</td>
                      <td className={clsx("px-4", s.missing ? "text-amber" : "text-muted")}>{s.missing ? `${s.missing_pct}%` : "0"}</td>
                      <td className="px-4 text-ink-2">{int(s.unique)}</td>
                      <td className="px-4">{f && f.category !== "non_sensitive" ? <Badge tone={CAT_TONE[f.category]}>{CAT_LABEL[f.category]}{f.pii_types.length ? ` · ${f.pii_types.join(", ")}` : ""}</Badge> : <span className="text-muted">{s.name === d.target_hint ? "target" : "—"}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
        <div className="space-y-6">
          {active && <ColumnPanel s={active} />}
          <Panel title="Data quality">
            {missing.length ? <Bars label="Missing values per column" data={missing} xKey="col" series={[{ key: "pct", name: "Missing %", color: c.amber }]} yFmt={(v) => `${v}%`} height={160} /> : <p className="text-sm text-signal">No missing values.</p>}
            <ul className="mt-3 space-y-1 text-[13px] text-ink-2">
              {p.quality.issues.length ? p.quality.issues.map((i) => <li key={i}>• {i}</li>) : <li>No issues detected.</li>}
            </ul>
          </Panel>
        </div>
      </div>
      <Preview id={id} />
    </div>
  );
}

function ColumnPanel({ s }: { s: ColumnStat }) {
  const c = useChartColors();
  return (
    <Panel title={s.name} subtitle={`${s.kind} · ${s.dtype}`}>
      {s.histogram ? (
        <>
          <Bars label={`Distribution of ${s.name}`} data={s.histogram.counts.map((v, i) => ({ bin: s.histogram!.edges[i].toFixed(s.histogram!.edges[1] - s.histogram!.edges[0] < 1 ? 2 : 0), v }))} xKey="bin" series={[{ key: "v", name: "Rows", color: c.blue }]} height={180} />
          <div className="num mt-3 grid grid-cols-3 gap-2 text-xs text-muted">
            <span>mean <b className="font-medium text-ink">{s.mean?.toFixed(2)}</b></span>
            <span>median <b className="font-medium text-ink">{s.median?.toFixed(2)}</b></span>
            <span>std <b className="font-medium text-ink">{s.std?.toFixed(2)}</b></span>
            <span>min <b className="font-medium text-ink">{s.min}</b></span>
            <span>max <b className="font-medium text-ink">{s.max}</b></span>
          </div>
        </>
      ) : (
        <Bars label={`Most frequent values of ${s.name}`} data={(s.top_values ?? []).map((t) => ({ v: t.value.length > 16 ? t.value.slice(0, 15) + "…" : t.value, n: t.count }))} xKey="v" layout="vertical" series={[{ key: "n", name: "Rows", color: c.indigo }]} height={Math.max(140, (s.top_values?.length ?? 1) * 26)} />
      )}
    </Panel>
  );
}

function Preview({ id }: { id: string }) {
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const q = useQuery({ queryKey: ["rows", id, offset], queryFn: () => api.rows(id, offset, limit), placeholderData: (p) => p });
  useEffect(() => {
    setOffset(0);
  }, [id]);
  return (
    <Panel
      title="Preview"
      subtitle={q.data ? `Rows ${offset + 1}–${Math.min(offset + limit, q.data.total)} of ${int(q.data.total)}` : undefined}
      actions={
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" aria-label="Previous page" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} icon={<ChevronLeft className="size-4" />} />
          <Button size="sm" variant="ghost" aria-label="Next page" disabled={!q.data || offset + limit >= q.data.total} onClick={() => setOffset(offset + limit)} icon={<ChevronRight className="size-4" />} />
        </div>
      }
      bodyClass="p-0"
    >
      {q.data ? (
        <div className="scrollbar-thin overflow-x-auto" tabIndex={0} role="region" aria-label="Dataset preview rows">
          <table className="w-full text-left text-xs">
            <thead className="bg-bg-2 text-muted">
              <tr>
                {q.data.columns.map((c) => (
                  <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((r, i) => (
                <tr key={i} className="border-t border-line/50">
                  {q.data!.columns.map((c) => (
                    <td key={c} className="max-w-[200px] truncate whitespace-nowrap px-3 py-1.5 font-mono text-ink-2">
                      {r[c] == null ? <span className="text-muted">null</span> : String(r[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-5">
          <Spinner />
        </div>
      )}
      <p className="flex items-center gap-1.5 border-t border-line px-5 py-2.5 text-xs text-muted">
        <FileUp className="size-3.5" aria-hidden /> Export neutralises spreadsheet formulas (cells starting with = + - @) to prevent CSV injection.
      </p>
    </Panel>
  );
}
