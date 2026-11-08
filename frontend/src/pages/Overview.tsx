import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Boxes, Database, FileText, FlaskConical, Network, ScanSearch, ShieldHalf, Sparkles, Swords } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { PrivacyUtility } from "../components/charts";
import { BrandMark } from "../components/Layout";
import { ExpRow } from "../components/shared";
import { Button, Empty, ErrorNote, Panel, Spinner, Stat, useToast } from "../components/ui";
import { api } from "../lib/api";
import { ago, eps, fx, pct, TYPE_LABEL } from "../lib/format";

const ACTIONS = [
  { to: "/datasets", icon: Database, title: "Load data", body: "Generate a synthetic dataset or upload a CSV." },
  { to: "/inspector", icon: ScanSearch, title: "Inspect PII", body: "Find identifiers, then mask or generalise them." },
  { to: "/dp", icon: ShieldHalf, title: "Train with DP-SGD", body: "Set ε and δ; the accountant tracks the budget." },
  { to: "/federated", icon: Network, title: "Simulate clients", body: "FedAvg with optional client-level DP." },
  { to: "/attacks", icon: Swords, title: "Attack a model", body: "Measure membership inference leakage." },
];

export default function Overview() {
  const q = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard, refetchInterval: 5000 });
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const seed = useMutation({
    mutationFn: () => api.synthetic("patients", 4000),
    onSuccess: () => {
      qc.invalidateQueries();
      toast({ tone: "success", title: "Synthetic patient dataset created", body: "4,000 fictional records with identifiers and a risk label." });
      nav("/datasets");
    },
  });

  if (q.isLoading) return <Spinner label="Loading workspace" />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const t = d.totals;
  const dpPoints = d.model_points.filter((p) => p.epsilon != null && p.accuracy != null && p.privacy_unit === "example").map((p) => ({ epsilon: p.epsilon!, accuracy: p.accuracy!, name: p.label }));
  const conv = d.model_points.filter((p) => p.epsilon == null && p.kind === "conventional" && p.accuracy != null);
  const bestConv = conv.length ? Math.max(...conv.map((p) => p.accuracy!)) : undefined;

  return (
    <div className="space-y-6">
      {/* Hero: the privacy ledger for this workspace */}
      <section className="panel relative overflow-hidden">
        <div className="pointer-events-none absolute -right-24 -top-24 size-[420px] rounded-full opacity-60 blur-3xl" style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--c-violet) 30%, transparent), transparent 65%)" }} aria-hidden />
        <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.25fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <BrandMark className="size-10" />
              <span className="text-sm text-ink-2">Umbra workspace</span>
            </div>
            <h1 className="mt-5 max-w-xl text-[32px] font-semibold leading-[1.15] tracking-tight text-ink sm:text-[38px]">Train on sensitive data, and measure what the model gives away.</h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-2">
              Differential privacy with real accounting, federated training across simulated clients, and membership inference attacks to test the result. Every number on this page comes from runs in this workspace.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {t.datasets === 0 ? (
                <Button variant="primary" icon={<Sparkles className="size-4" />} loading={seed.isPending} onClick={() => seed.mutate()}>
                  Create a demo dataset
                </Button>
              ) : (
                <Link to="/dp">
                  <Button variant="primary" icon={<ShieldHalf className="size-4" />}>
                    Train a private model
                  </Button>
                </Link>
              )}
              <Link to="/docs">
                <Button variant="ghost">How the guarantees work</Button>
              </Link>
            </div>
          </div>
          <div className="rounded-xl border border-line bg-bg-2/70 p-5">
            <p className="text-[13px] text-muted">Example-level privacy budget across trained models</p>
            {d.privacy_budget.min_epsilon != null ? (
              <>
                <div className="mt-3 flex items-end gap-6">
                  <div>
                    <p className="num text-[40px] font-semibold leading-none text-violet">{eps(d.privacy_budget.min_epsilon)}</p>
                    <p className="mt-1 text-xs text-muted">strongest ε</p>
                  </div>
                  <div>
                    <p className="num text-2xl font-semibold leading-none text-ink">{eps(d.privacy_budget.median_epsilon)}</p>
                    <p className="mt-1 text-xs text-muted">median</p>
                  </div>
                  <div>
                    <p className="num text-2xl font-semibold leading-none text-ink-2">{eps(d.privacy_budget.max_epsilon)}</p>
                    <p className="mt-1 text-xs text-muted">weakest</p>
                  </div>
                </div>
                <EpsilonRail points={d.model_points.filter((p) => p.epsilon != null && p.privacy_unit === "example").map((p) => p.epsilon!)} />
                <p className="mt-3 text-xs text-muted">
                  {t.dp_models} of {t.models} saved models carry a formal (ε, δ) guarantee.
                  {d.privacy_budget.client_level_models > 0 && ` ${d.privacy_budget.client_level_models} client-level (DP-FedAvg) model${d.privacy_budget.client_level_models > 1 ? "s are" : " is"} not included: client-level ε measures a different unit.`}
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm leading-relaxed text-ink-2">No private models yet. Train one in the Differential Privacy studio and its budget will appear here.</p>
            )}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Experiments" value={t.experiments} hint={`${t.completed} completed · ${t.failed} failed`} icon={<FlaskConical className="size-4" />} tone="indigo" />
        <Stat label="Active jobs" value={t.running} hint={t.running ? "running now" : "idle"} icon={<Activity className="size-4" />} tone="blue" />
        <Stat label="Saved models" value={t.models} hint={`${t.dp_models} differentially private`} icon={<Boxes className="size-4" />} />
        <Stat label="Federated clients" value={t.federated_clients || "—"} hint="largest simulation" icon={<Network className="size-4" />} tone="signal" />
        <Stat label="Datasets" value={t.datasets} icon={<Database className="size-4" />} />
        <Stat label="Reports" value={t.reports} icon={<FileText className="size-4" />} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Panel title="Privacy versus accuracy" subtitle="Every example-level DP model trained in this workspace">
          {dpPoints.length ? (
            <PrivacyUtility connect={false} label="Accuracy of each differentially private model against its epsilon" points={dpPoints} baseline={bestConv} />
          ) : (
            <Empty icon={<ShieldHalf className="size-5" />} title="Nothing to plot yet" body="Run a privacy budget sweep to see how accuracy changes as ε tightens." action={<Link to="/dp"><Button>Open the DP studio</Button></Link>} />
          )}
        </Panel>
        <Panel title="Recent activity" actions={<Link to="/experiments" className="text-[13px] text-indigo hover:underline">All experiments</Link>} bodyClass="p-2">
          {d.recent.length ? (
            <div className="space-y-0.5">
              {d.recent.map((e) => (
                <ExpRow key={e.id} e={e} onClick={() => nav(`/experiments?id=${e.id}`)} />
              ))}
            </div>
          ) : (
            <Empty icon={<FlaskConical className="size-5" />} title="No experiments yet" body="Runs you start in any studio show up here with live progress." />
          )}
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1.5fr]">
        <Panel title="Attack resistance" subtitle="Best membership-inference AUC per target model">
          {d.attacks.length ? (
            <ul className="space-y-3">
              {d.attacks.slice(0, 6).map((a, i) => (
                <li key={i}>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-ink">{a.label}</span>
                    <span className="num text-ink-2">
                      AUC {fx(a.auc, 3)} · ε {eps(a.epsilon)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(0, ((a.auc ?? 0.5) - 0.5) * 200)}%`, background: (a.auc ?? 0) > 0.6 ? "var(--c-rose)" : (a.auc ?? 0) > 0.55 ? "var(--c-amber)" : "var(--c-signal)" }} />
                  </div>
                </li>
              ))}
              <li className="pt-1 text-xs text-muted">Bar length is AUC above 0.5 (random guessing).</li>
            </ul>
          ) : (
            <Empty icon={<Swords className="size-5" />} title="No attacks run" body="The Attack Laboratory trains a target model and tries to tell its training records apart from unseen ones." />
          )}
        </Panel>
        <Panel title="Start something">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ACTIONS.map(({ to, icon: Icon, title, body }) => (
              <Link key={to} to={to} className="group rounded-xl border border-line bg-bg-2 p-4 transition-colors hover:border-indigo/50 hover:bg-raised">
                <Icon className="size-5 text-indigo" aria-hidden />
                <p className="mt-3 text-sm font-medium text-ink">{title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{body}</p>
              </Link>
            ))}
            <div className="rounded-xl border border-dashed border-line p-4">
              <p className="text-sm font-medium text-ink">Recent reports</p>
              {d.recent_reports.length ? (
                <ul className="mt-2 space-y-1.5 text-[13px]">
                  {d.recent_reports.map((r) => (
                    <li key={r.id} className="flex justify-between gap-2">
                      <a className="truncate text-indigo hover:underline" href={api.reportUrl(r.id, "html")} target="_blank" rel="noopener noreferrer">
                        {r.title}
                      </a>
                      <span className="shrink-0 text-muted">{ago(r.created_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-[13px] text-muted">Generate one from any completed experiment.</p>
              )}
            </div>
          </div>
        </Panel>
      </div>
      <p className="text-xs text-muted">
        By type:{" "}
        {Object.entries(d.by_type)
          .map(([k, v]) => `${TYPE_LABEL[k] ?? k} ${v}`)
          .join(", ") || "none"}
        {bestConv != null && ` · best conventional accuracy ${pct(bestConv)}`}
      </p>
    </div>
  );
}

/** Log-scale rail placing each model's ε between 0.1 and 100. */
function EpsilonRail({ points }: { points: number[] }) {
  const pos = (e: number) => Math.min(100, Math.max(0, ((Math.log10(e) + 1) / 3) * 100));
  return (
    <div className="mt-5" aria-label={`Epsilon values: ${points.map((p) => p.toFixed(2)).join(", ")}`} role="img">
      <div className="relative h-2 rounded-full" style={{ background: "linear-gradient(90deg, var(--c-signal), var(--c-violet) 45%, var(--c-amber) 75%, var(--c-rose))" }}>
        {points.map((e, i) => (
          <span key={i} className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-ink" style={{ left: `${pos(e)}%` }} title={`ε = ${e.toFixed(3)}`} />
        ))}
      </div>
      <div className="num mt-1.5 flex justify-between text-[11px] text-muted">
        <span>0.1</span>
        <span>1</span>
        <span>10</span>
        <span>100</span>
      </div>
    </div>
  );
}
