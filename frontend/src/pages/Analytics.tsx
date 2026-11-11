import { useQueries, useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { useMemo, useState } from "react";
import { Bars, Lines, PrivacyUtility } from "../components/charts";
import { PageHeader } from "../components/Layout";
import { MetricBars, MetricsTable } from "../components/shared";
import { Empty, Panel, Spinner } from "../components/ui";
import { api, type Experiment, type ModelResult } from "../lib/api";
import { TYPE_LABEL } from "../lib/format";
import { shortenAtWord } from "../lib/ticks";
import { useChartColors } from "../lib/theme";

export default function Analytics() {
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
  const list = useQuery({ queryKey: ["experiments"], queryFn: () => api.experiments() });
  const completed = (list.data ?? []).filter((e) => e.status === "completed" && e.type !== "pii");
  const full = useQueries({ queries: completed.slice(0, 30).map((e) => ({ queryKey: ["experiment", e.id], queryFn: () => api.experiment(e.id), staleTime: 60_000 })) });
  const exps = full.map((q) => q.data).filter(Boolean) as Experiment[];
  const c = useChartColors();
  const [pick, setPick] = useState<string[]>([]);

  const allModels = useMemo(() => exps.flatMap((e) => (e.results?.models ?? []).map((m) => ({ ...m, label: `${m.label} · ${shortenAtWord(e.name, 32)}`, fullLabel: `${m.label} · ${e.name}`, _exp: e.id }))) as (ModelResult & { _exp: string; fullLabel: string })[], [exps]);
  if (dash.isLoading || list.isLoading) return <Spinner label="Loading analytics" />;
  if (!completed.length)
    return (
      <div>
        <PageHeader icon={<BarChart3 className="size-5" />} title="Analytics" description="Compare results across every completed experiment." />
        <Panel>
          <Empty icon={<BarChart3 className="size-5" />} title="No completed experiments" body="Charts here aggregate stored results, so they appear once runs have finished." />
        </Panel>
      </div>
    );

  const points = (dash.data?.model_points ?? []).filter((p) => p.epsilon != null && p.accuracy != null && p.privacy_unit === "example").map((p) => ({ epsilon: p.epsilon!, accuracy: p.accuracy!, name: p.label }));
  const conv = (dash.data?.model_points ?? []).filter((p) => p.kind === "conventional" && p.accuracy != null);
  const budgetTrend = (dash.data?.model_points ?? [])
    .filter((p) => p.epsilon != null && p.privacy_unit === "example")
    .slice()
    .reverse()
    .map((p, i) => ({ run: i + 1, epsilon: p.epsilon, accuracy: p.accuracy }));
  const attackPts = (dash.data?.attacks ?? []).map((a) => ({ target: a.label, auc: a.auc }));
  const fedRuns = exps.filter((e) => e.type === "federated").map((e) => ({ run: e.name.replace("FedAvg · ", ""), fed: e.results!.federated!.final.accuracy, central: e.results!.models![0].test.accuracy }));
  const compareModels = pick.length ? allModels.filter((m) => pick.includes(m.model_id)) : allModels.slice(0, 4);

  return (
    <div className="space-y-6">
      <PageHeader icon={<BarChart3 className="size-5" />} title="Analytics" description={`Aggregated from ${completed.length} completed experiments and ${dash.data?.totals.models ?? 0} saved models.`} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Privacy budget versus accuracy" subtitle="Example-level DP models (client-level runs excluded); dashed line is the best conventional model">
          {points.length ? <PrivacyUtility connect={false} label="Accuracy against epsilon for every DP model" points={points} baseline={conv.length ? Math.max(...conv.map((p) => p.accuracy!)) : undefined} /> : <p className="text-sm text-muted">No DP models yet.</p>}
        </Panel>
        <Panel title="Privacy budget trend" subtitle="Example-level ε of DP models in the order they were trained">
          {budgetTrend.length ? <Lines label="Epsilon and accuracy by training order" data={budgetTrend} xKey="run" series={[{ key: "epsilon", name: "ε", color: c.violet, dot: true }]} yFmt={(v) => v.toFixed(2)} xLabel="DP model #" /> : <p className="text-sm text-muted">No DP models yet.</p>}
        </Panel>
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Membership inference AUC by target">
          {attackPts.length ? <Bars label="Best membership inference AUC per attacked model" data={attackPts} xKey="target" series={[{ key: "auc", name: "AUC", color: c.rose }]} yDomain={[0, 1]} yFmt={(v) => v.toFixed(2)} /> : <p className="text-sm text-muted">Run the Attack Laboratory to populate this chart.</p>}
        </Panel>
        <Panel title="Federated vs centralized accuracy">
          {fedRuns.length ? <Bars label="Federated global accuracy versus centralized reference" data={fedRuns} xKey="run" series={[{ key: "central", name: "Centralized", color: c.blue }, { key: "fed", name: "Federated", color: c.signal }]} yDomain={[0, 1]} yFmt={(v) => `${Math.round(v * 100)}%`} /> : <p className="text-sm text-muted">No federated runs yet.</p>}
        </Panel>
      </div>
      <Panel title="Compare models" subtitle="Pick up to six models; the first four are shown by default.">
        <div className="mb-5 flex flex-wrap gap-2">
          {allModels.map((m) => {
            const on = pick.includes(m.model_id);
            return (
              <button
                key={m.model_id}
                aria-pressed={on}
                title={m.fullLabel}
                onClick={() => setPick((p) => (on ? p.filter((x) => x !== m.model_id) : p.length < 6 ? [...p, m.model_id] : p))}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${on ? "border-indigo bg-indigo/15 text-ink" : "border-line text-ink-2 hover:border-line-strong"}`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1fr_1.2fr]">
          <MetricBars models={compareModels} height={280} />
          <MetricsTable models={compareModels} />
        </div>
      </Panel>
      <p className="text-xs text-muted">
        Experiment types included: {[...new Set(completed.map((e) => TYPE_LABEL[e.type]))].join(", ")}.
      </p>
    </div>
  );
}
