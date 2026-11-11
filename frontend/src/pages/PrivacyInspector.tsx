import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Eye, FlaskConical, Save, ScanSearch } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/Layout";
import { RunButton, RunStatus, useDatasets } from "../components/shared";
import { Badge, Button, Callout, ErrorNote, NumberInput, Panel, Select, Spinner, Stat, useToast } from "../components/ui";
import { KAnonCompare, PiiView, SampleCompare } from "../components/views";
import { api, type Action, type Finding, type Rule, type TransformReport } from "../lib/api";
import { useRunner } from "../lib/hooks";

const ACTIONS: { value: Action; label: string; help: string }[] = [
  { value: "keep", label: "Keep", help: "Leave the column unchanged." },
  { value: "suppress", label: "Suppress", help: "Drop the column entirely (data minimisation)." },
  { value: "redact", label: "Redact", help: "Replace every value with [REDACTED]." },
  { value: "mask", label: "Mask", help: "Hide most characters but keep format hints, e.g. a***@example.com." },
  { value: "pseudonymize", label: "Pseudonymize", help: "Keyed HMAC token. Joins still work; whoever holds the key can re-link." },
  { value: "generalize", label: "Generalize", help: "Bin numbers or truncate strings (ZIP 94110 → 941**)." },
  { value: "local_dp", label: "Local DP", help: "Laplace noise (numbers) or randomized response (categories) per record, with its own ε." },
];

const CAT: Record<Finding["category"], { label: string; tone: "rose" | "amber" | "violet" | "muted" }> = {
  direct_identifier: { label: "Direct identifier", tone: "rose" },
  quasi_identifier: { label: "Quasi-identifier", tone: "amber" },
  sensitive_attribute: { label: "Sensitive attribute", tone: "violet" },
  non_sensitive: { label: "Not flagged", tone: "muted" },
};

export default function PrivacyInspector() {
  const [params, setParams] = useSearchParams();
  const ds = useDatasets();
  const id = params.get("ds") ?? ds.data?.[0]?.id ?? null;
  return (
    <div>
      <PageHeader
        icon={<ScanSearch className="size-5" />}
        title="Privacy Inspector"
        description="Find direct identifiers and quasi-identifiers, choose a protection for each, and compare the data before and after. Detection is heuristic, so review the findings yourself."
        actions={
          ds.data?.length ? (
            <div className="w-72">
              <Select ariaLabel="Dataset to inspect" value={id ?? ""} onChange={(v) => setParams({ ds: v })} options={ds.data.map((d) => ({ value: d.id, label: d.name }))} />
            </div>
          ) : undefined
        }
      />
      {ds.isLoading ? <Spinner /> : id ? <Inspector key={id} id={id} /> : <Callout>Create a dataset in the Dataset Studio first.</Callout>}
      <Glossary />
    </div>
  );
}

function Inspector({ id }: { id: string }) {
  const scan = useQuery({ queryKey: ["pii", id], queryFn: () => api.pii(id) });
  const meta = useQuery({ queryKey: ["dataset", id], queryFn: () => api.dataset(id) });
  const [rules, setRules] = useState<Record<string, Rule>>({});
  const [report, setReport] = useState<TransformReport | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const runner = useRunner(`run-pii-${id}`);

  useEffect(() => {
    if (!scan.data) return;
    const r: Record<string, Rule> = {};
    for (const f of scan.data.findings) r[f.column] = { column: f.column, action: f.recommended_action, epsilon: 1, keep_chars: 3 };
    setRules(r);
  }, [scan.data]);

  const active = useMemo(() => Object.values(rules).filter((r) => r.action !== "keep"), [rules]);
  const preview = useMutation({
    mutationFn: (save: boolean) => api.transform(id, active, save),
    onSuccess: (res, save) => {
      setReport(res.report);
      if (save && res.saved) {
        qc.invalidateQueries({ queryKey: ["datasets"] });
        toast({ tone: "success", title: "Protected copy saved", body: `"${res.saved.name}" is now available in every studio.` });
      }
    },
    onError: (e) => toast({ tone: "error", title: "Transformation failed", body: (e as Error).message }),
  });

  if (scan.isLoading) return <Spinner label="Scanning columns" />;
  if (scan.error) return <ErrorNote error={scan.error} onRetry={() => scan.refetch()} />;
  const s = scan.data!;
  const level = s.summary.risk_level;
  const k = s.k_anonymity;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="panel p-4">
          <p className="text-[13px] text-muted">Re-identification risk</p>
          <div className="mt-2 flex items-end gap-3">
            <span className={clsx("num text-[34px] font-semibold leading-none", level === "high" ? "text-rose" : level === "medium" ? "text-amber" : "text-signal")}>{s.summary.risk_score}</span>
            <Badge tone={level === "high" ? "rose" : level === "medium" ? "amber" : "signal"} dot>
              {level}
            </Badge>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-raised">
            <div className={clsx("h-full rounded-full", level === "high" ? "bg-rose" : level === "medium" ? "bg-amber" : "bg-signal")} style={{ width: `${s.summary.risk_score}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">Heuristic score from identifiers and uniqueness.</p>
        </div>
        <Stat label="Direct identifiers" value={s.summary.direct_identifiers.length} tone="rose" hint={s.summary.direct_identifiers.join(", ") || "none found"} />
        <Stat label="Quasi-identifiers" value={s.summary.quasi_identifiers.length} tone="amber" hint={s.summary.quasi_identifiers.join(", ") || "none found"} />
        <Stat label="Unique on quasi-identifiers" value={`${k.unique_pct}%`} tone={k.unique_pct > 20 ? "rose" : "amber"} hint={`k-anonymity k = ${k.k ?? "—"} over ${k.classes} classes`} />
      </div>

      <Panel
        title="Findings and protections"
        subtitle="Recommended actions are pre-selected. Change any of them, then preview."
        actions={
          <>
            <Button size="sm" icon={<Eye className="size-3.5" />} loading={preview.isPending && !preview.variables} disabled={!active.length} onClick={() => preview.mutate(false)}>
              Preview
            </Button>
            <Button size="sm" icon={<Save className="size-3.5" />} loading={preview.isPending && preview.variables === true} disabled={!active.length} onClick={() => preview.mutate(true)}>
              Save protected copy
            </Button>
          </>
        }
        bodyClass="p-0"
      >
        <div className="scrollbar-thin relative overflow-x-auto" tabIndex={0} role="region" aria-label="Findings and protections">
          <table className="w-full min-w-[900px] text-left text-[13px]">
            <thead className="text-muted">
              <tr className="border-b border-line">
                {["Column", "Classification", "Evidence", "Confidence", "Protection", "Parameters"].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.findings.map((f) => {
                const r = rules[f.column];
                if (!r) return null;
                const set = (patch: Partial<Rule>) => setRules((x) => ({ ...x, [f.column]: { ...x[f.column], ...patch } }));
                return (
                  <tr key={f.column} className={clsx("border-b border-line/50 align-top", f.category === "direct_identifier" && "bg-rose/[0.04]")}>
                    <td className="px-4 py-3 font-medium text-ink">{f.column}</td>
                    <td className="px-4 py-3">
                      <Badge tone={CAT[f.category].tone}>{CAT[f.category].label}</Badge>
                      {f.pii_types.length > 0 && <p className="mt-1 text-xs text-muted">{f.pii_types.join(", ")}</p>}
                    </td>
                    <td className="max-w-[280px] px-4 py-3 text-xs leading-relaxed text-ink-2">{f.evidence.join("; ") || "—"}</td>
                    <td className="num px-4 py-3 text-ink-2">{f.confidence ? `${Math.round(f.confidence * 100)}%` : "—"}</td>
                    <td className="w-44 px-4 py-2">
                      <Select ariaLabel={`Protection for ${f.column}`} value={r.action} onChange={(v) => set({ action: v as Action })} options={ACTIONS.map((a) => ({ value: a.value, label: a.label }))} />
                    </td>
                    <td className="w-40 px-4 py-2">
                      {r.action === "local_dp" && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted">ε</span>
                          <NumberInput ariaLabel={`Local DP epsilon for ${f.column}`} value={r.epsilon ?? 1} min={0.01} max={20} step={0.1} onChange={(v) => set({ epsilon: v })} />
                        </div>
                      )}
                      {r.action === "generalize" && (
                        <div className="flex items-center gap-2">
                          <span className="whitespace-nowrap text-xs text-muted">keep chars</span>
                          <NumberInput ariaLabel={`Characters to keep for ${f.column}`} value={r.keep_chars ?? 3} min={0} max={20} onChange={(v) => set({ keep_chars: Math.round(v) })} />
                        </div>
                      )}
                      {r.action !== "local_dp" && r.action !== "generalize" && <span className="text-xs text-muted">{ACTIONS.find((a) => a.value === r.action)?.help}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-5 py-3 text-xs text-muted">{s.disclaimer}</p>
      </Panel>

      {report && (
        <>
          <Panel title="Before and after" subtitle="First rows of the dataset. Changed columns are highlighted.">
            <SampleCompare report={report} highlight={s.summary.direct_identifiers} />
          </Panel>
          <Panel title="Re-identification risk">
            <KAnonCompare report={report} />
          </Panel>
        </>
      )}

      <Panel
        title="PII protection experiment"
        subtitle="Scans, applies the protections above, saves the protected copy, and trains the same model on original and protected data to measure the accuracy cost."
        actions={
          <RunButton
            loading={runner.submit.isPending}
            disabled={runner.exp?.status === "running" || runner.exp?.status === "queued"}
            onClick={() => runner.submit.mutate({ type: "pii", name: `PII protection · ${meta.data?.name ?? "dataset"}`, pii: { dataset_id: id, target: meta.data?.target_hint, rules: active.length ? active : null, measure_utility: true }, model: { epochs: 12, hidden: [64, 32] } })}
          >
            Run protection experiment
          </RunButton>
        }
      >
        {runner.exp ? (
          <div className="space-y-6">
            <RunStatus exp={runner.exp} onReset={() => runner.setId(null)} />
            {runner.exp.status === "completed" && <PiiView r={runner.exp.results!} />}
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted">
            <FlaskConical className="size-4" aria-hidden /> Results are stored as an experiment and can be turned into a report.
          </p>
        )}
      </Panel>
    </div>
  );
}

function Glossary() {
  const items = [
    ["Anonymization", "Irreversibly removing the link between data and a person. Hard to achieve in practice: combinations of ordinary attributes often single people out."],
    ["Pseudonymization", "Replacing identifiers with tokens. Still personal data, because whoever holds the key or a lookup table can reverse it."],
    ["Data masking", "Hiding parts of a value for display or testing. Reduces casual exposure; offers no formal guarantee."],
    ["Differential privacy", "A mathematical bound (ε, δ) on how much any one record can change an output. Local DP noises each record; central DP noises the model or statistic."],
  ];
  return (
    <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Privacy techniques explained">
      {items.map(([t, b]) => (
        <div key={t} className="rounded-xl border border-line bg-surface/60 p-4">
          <p className="text-sm font-medium text-ink">{t}</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{b}</p>
        </div>
      ))}
    </section>
  );
}
