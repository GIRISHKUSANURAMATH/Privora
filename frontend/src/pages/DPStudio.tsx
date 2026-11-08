import { useQuery } from "@tanstack/react-query";
import { ShieldHalf } from "lucide-react";
import { useEffect, useState } from "react";
import { Lines } from "../components/charts";
import { PageHeader } from "../components/Layout";
import { DatasetPicker, ModelParamsForm, ReportButton, RunButton, RunStatus, type DataChoice, type ModelParams } from "../components/shared";
import { Badge, Callout, Field, NumberInput, Panel, Segmented, Select, Slider, Tip } from "../components/ui";
import { ExperimentResults } from "../components/views";
import { api } from "../lib/api";
import { epsBand, fx } from "../lib/format";
import { useRunner } from "../lib/hooks";
import { useChartColors } from "../lib/theme";

type Mode = "comparison" | "dp" | "budget_sweep";
type Budget = "target" | "noise";

const EPS_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 50];

function useDebounced<T>(v: T, ms = 350) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export default function DPStudio() {
  const [data, setData] = useState<DataChoice | null>(null);
  const [mode, setMode] = useState<Mode>("comparison");
  const [budget, setBudget] = useState<Budget>("target");
  const [epsIdx, setEpsIdx] = useState(7); // ε = 3
  const [sigma, setSigma] = useState(1.0);
  const [delta, setDelta] = useState(1e-5);
  const [clip, setClip] = useState(1.0);
  const [accountant, setAccountant] = useState<"rdp" | "prv">("rdp");
  const [sweep, setSweep] = useState("0.5, 1, 2, 4, 8");
  const [model, setModel] = useState<ModelParams>({ hidden: [64, 32], epochs: 15, batch_size: 128, lr: 0.002, optimizer: "adam", seed: 42 });
  const runner = useRunner("run-dp");
  const c = useChartColors();

  const ds = useQuery({ queryKey: ["datasets"], queryFn: api.datasets });
  const rows = ds.data?.find((d) => d.id === data?.dataset_id)?.rows ?? 0;
  const nTrain = rows - Math.round(rows * 0.3);
  const target = EPS_STEPS[epsIdx];

  const calcInput = useDebounced({ n: nTrain, batch_size: model.batch_size, epochs: model.epochs, delta, accountant, noise_multiplier: budget === "noise" ? sigma : null, target_epsilon: budget === "target" ? target : null });
  const calc = useQuery({
    queryKey: ["calc", calcInput],
    queryFn: () => api.calculator(calcInput),
    enabled: calcInput.n > model.batch_size && mode !== "budget_sweep",
    placeholderData: (p) => p,
    retry: false,
  });

  const sweepEps = sweep
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => x >= 0.05 && x <= 100);
  const deltaOk = nTrain > 0 && delta < 1 / nTrain;
  const running = runner.exp?.status === "running" || runner.exp?.status === "queued";

  const start = () => {
    if (!data) return;
    const dp = { delta, max_grad_norm: clip, accountant, target_epsilon: budget === "target" ? target : null, noise_multiplier: budget === "noise" ? sigma : null };
    const name = mode === "budget_sweep" ? `Budget sweep ε ∈ {${sweepEps.join(", ")}}` : mode === "comparison" ? `Conventional vs DP · ε ${budget === "target" ? target : `σ=${sigma}`}` : `DP-SGD · ε ${budget === "target" ? target : `σ=${sigma}`}`;
    runner.submit.mutate({
      type: mode,
      name,
      data: { dataset_id: data.dataset_id, target: data.target },
      model,
      dp: mode === "budget_sweep" ? undefined : dp,
      sweep: mode === "budget_sweep" ? { epsilons: sweepEps, delta, max_grad_norm: clip, accountant } : undefined,
    });
  };

  const shownEps = calc.data?.epsilon ?? (budget === "target" ? target : null);
  const band = epsBand(shownEps);

  return (
    <div>
      <PageHeader
        icon={<ShieldHalf className="size-5" />}
        title="Differential Privacy Studio"
        description="Train with DP-SGD through Opacus. Per-example gradients are clipped to norm C, Gaussian noise σ·C is added, and a privacy accountant composes every step into a single (ε, δ) guarantee."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Panel title="Experiment">
            <div className="space-y-5">
              <DatasetPicker value={data} onChange={setData} />
              <Field label="What to run">
                <Segmented<Mode>
                  ariaLabel="Experiment mode"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "comparison", label: "Conventional vs DP" },
                    { value: "dp", label: "DP only" },
                    { value: "budget_sweep", label: "Budget sweep" },
                  ]}
                />
              </Field>
            </div>
          </Panel>
          <Panel title="Privacy parameters" subtitle="Every value here feeds the accountant directly.">
            <div className="space-y-5">
              {mode === "budget_sweep" ? (
                <Field label="Target ε values" htmlFor="sweep" hint="Comma-separated. One DP model is trained per value, plus a conventional reference.">
                  <input id="sweep" value={sweep} onChange={(e) => setSweep(e.target.value)} className="h-10 w-full rounded-lg border border-line-strong bg-bg-2 px-3 text-sm text-ink outline-none focus:border-indigo focus:ring-2 focus:ring-indigo/30" />
                </Field>
              ) : (
                <>
                  <Field label="Set the budget by">
                    <Segmented<Budget> ariaLabel="Budget mode" value={budget} onChange={setBudget} options={[{ value: "target", label: "Target ε" }, { value: "noise", label: "Noise multiplier σ" }]} />
                  </Field>
                  {budget === "target" ? (
                    <Field label={<>Target ε <Tip>Upper bound on privacy loss. Smaller is more private. The accountant searches for the smallest σ that keeps total ε at or below this value after all epochs.</Tip></>} htmlFor="eps">
                      <Slider id="eps" label="Target epsilon" min={0} max={EPS_STEPS.length - 1} step={1} value={epsIdx} onChange={setEpsIdx} format={(i) => String(EPS_STEPS[i])} />
                    </Field>
                  ) : (
                    <Field label={<>Noise multiplier σ <Tip>Standard deviation of the added noise relative to C. The accountant computes the resulting ε.</Tip></>} htmlFor="sig">
                      <Slider id="sig" label="Noise multiplier" min={0.3} max={5} step={0.05} value={sigma} onChange={setSigma} format={(v) => v.toFixed(2)} />
                    </Field>
                  )}
                </>
              )}
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={<>δ <Tip>Probability that the ε bound fails. Must be well below 1/n; a common choice is 1e-5 or smaller.</Tip></>} htmlFor="delta" hint={nTrain ? `must be < 1/n = ${(1 / nTrain).toExponential(1)}` : undefined}>
                  <NumberInput id="delta" value={delta} min={1e-12} max={0.1} step={1e-6} onChange={setDelta} />
                </Field>
                <Field label={<>Clipping norm C <Tip>Each per-example gradient is scaled down to at most this L2 norm, which bounds any one record's influence.</Tip></>} htmlFor="clip">
                  <NumberInput id="clip" value={clip} min={0.01} max={100} step={0.1} onChange={setClip} />
                </Field>
                <Field label={<>Accountant <Tip>RDP is Opacus' default. PRV is numerically tighter. Both are rigorous upper bounds.</Tip></>} htmlFor="acct">
                  <Select id="acct" value={accountant} onChange={(v) => setAccountant(v as "rdp")} options={[{ value: "rdp", label: "Rényi DP (RDP)" }, { value: "prv", label: "PRV" }]} />
                </Field>
              </div>
              {!deltaOk && nTrain > 0 && <Callout tone="amber">δ = {delta} is not below 1/n for {nTrain} training rows. The run will be rejected; lower δ.</Callout>}
            </div>
          </Panel>
          <Panel title="Model and optimisation" subtitle="The same settings are used for the conventional reference.">
            <ModelParamsForm value={model} onChange={setModel} />
          </Panel>
        </div>

        <div className="space-y-6">
          <section className="panel overflow-hidden" aria-label="Privacy budget preview">
            <div className="border-b border-line px-5 py-4">
              <h2 className="text-[15px] font-semibold text-ink">Budget preview</h2>
              <p className="mt-0.5 text-[13px] text-muted">Live from the accountant for {nTrain ? `${nTrain.toLocaleString()} training rows` : "the selected dataset"}. The run reports its own final value.</p>
            </div>
            {mode === "budget_sweep" ? (
              <div className="p-5 text-sm leading-relaxed text-ink-2">
                A sweep trains {sweepEps.length} DP models, one per target ε ({sweepEps.join(", ")}), plus a conventional model, all on the same split and seed. The result is a measured privacy–utility curve.
              </div>
            ) : (
              <div className="p-5">
                <BudgetDial epsilon={shownEps} loading={calc.isFetching} />
                <div className="mt-4 flex justify-center">
                  <Badge tone={band.tone === "muted" ? "muted" : band.tone}>{band.label} guarantee</Badge>
                </div>
                {calc.error && <p className="mt-3 text-center text-sm text-rose">{(calc.error as Error).message}</p>}
                {calc.data && (
                  <>
                    <div className="num mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {[
                        ["σ", fx(calc.data.noise_multiplier, 3)],
                        ["noise σ·C", fx(calc.data.noise_multiplier * clip, 3)],
                        ["sample rate q", fx(calc.data.sample_rate, 4)],
                        ["steps", calc.data.steps.toLocaleString()],
                      ].map(([k, v]) => (
                        <div key={k} className="rounded-lg border border-line bg-bg-2 px-3 py-2">
                          <p className="text-[11px] text-muted">{k}</p>
                          <p className="mt-0.5 text-sm font-medium text-ink">{v}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-5">
                      <p className="mb-2 text-[13px] font-medium text-ink-2">ε accumulates with every step</p>
                      <Lines label="Epsilon as a function of training steps" data={calc.data.curve} xKey="step" series={[{ key: "epsilon", name: "ε", color: c.violet }]} height={180} yFmt={(v) => v.toFixed(2)} />
                    </div>
                    <div className="mt-4 rounded-lg border border-line bg-bg-2 p-3">
                      <p className="text-[13px] font-medium text-ink-2">Same mechanism, three accountants</p>
                      <div className="num mt-2 grid grid-cols-3 gap-2 text-[13px]">
                        {(["rdp", "prv", "gdp"] as const).map((k) => (
                          <div key={k}>
                            <p className="text-xs text-muted">{k === "gdp" ? "GDP (approx.)" : k.toUpperCase()}</p>
                            <p className="font-medium text-ink">{typeof calc.data!.comparison[k] === "number" ? fx(calc.data!.comparison[k] as number, 3) : "n/a"}</p>
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-muted">GDP uses a central-limit approximation and is shown for comparison only.</p>
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
              <RunButton onClick={start} loading={runner.submit.isPending} disabled={!data?.target || running || !deltaOk || (mode === "budget_sweep" && !sweepEps.length)}>
                {mode === "budget_sweep" ? `Run sweep (${sweepEps.length + 1} models)` : mode === "comparison" ? "Train both models" : "Train with DP-SGD"}
              </RunButton>
              <p className="text-xs text-muted">Runs locally on CPU{mode === "budget_sweep" ? "; a sweep takes a few minutes" : ""}.</p>
            </div>
          </section>
          <Callout tone="violet" title="Central DP, not local">
            The trainer sees raw records; the released model is what is protected. Preprocessing statistics (means, category lists) are computed without noise and treated as public. Tuning hyper-parameters across many runs spends extra budget that is not counted here.
          </Callout>
        </div>
      </div>

      {runner.exp && (
        <div className="mt-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">Results</h2>
            <ReportButton exp={runner.exp} />
          </div>
          <RunStatus exp={runner.exp} onReset={() => runner.setId(null)} />
          {runner.exp.status === "completed" && <ExperimentResults exp={runner.exp} />}
        </div>
      )}
    </div>
  );
}

/** Semicircular ε dial on a log scale from 0.1 to 50. The signature element of the studio. */
function BudgetDial({ epsilon, loading }: { epsilon: number | null; loading?: boolean }) {
  const t = epsilon == null ? 1 : Math.min(1, Math.max(0, (Math.log10(epsilon) + 1) / (Math.log10(50) + 1)));
  const angle = Math.PI * (1 - t);
  const r = 92;
  const cx = 120;
  const cy = 112;
  const x = cx + (r - 2) * Math.cos(angle);
  const y = cy - (r - 2) * Math.sin(angle);
  const x0 = cx + (r - 26) * Math.cos(angle);
  const y0 = cy - (r - 26) * Math.sin(angle);
  const ticks = [0.1, 1, 10, 50];
  return (
    <div className="flex justify-center" role="img" aria-label={`Epsilon ${epsilon == null ? "unknown" : epsilon.toFixed(3)}`}>
      <svg viewBox="0 0 240 126" className="w-full max-w-[320px]">
        <defs>
          <linearGradient id="dial" x1="0" x2="1">
            <stop offset="0" stopColor="var(--c-signal)" />
            <stop offset="0.45" stopColor="var(--c-violet)" />
            <stop offset="0.75" stopColor="var(--c-amber)" />
            <stop offset="1" stopColor="var(--c-rose)" />
          </linearGradient>
        </defs>
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} stroke="var(--c-line)" strokeWidth="12" fill="none" strokeLinecap="round" />
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} stroke="url(#dial)" strokeWidth="12" fill="none" strokeLinecap="round" opacity="0.9" />
        {ticks.map((v) => {
          const tt = (Math.log10(v) + 1) / (Math.log10(50) + 1);
          const a = Math.PI * (1 - tt);
          return (
            <text key={v} x={cx + (r + 18) * Math.cos(a)} y={cy - (r + 18) * Math.sin(a) + 4} textAnchor="middle" fontSize="9" fill="var(--c-muted)">
              {v}
            </text>
          );
        })}
        <line x1={x0} y1={y0} x2={x} y2={y} stroke="var(--c-text)" strokeWidth="3" strokeLinecap="round" />
        <circle cx={x} cy={y} r="7" fill="var(--c-bg)" stroke="var(--c-text)" strokeWidth="3" />
        <text x={cx} y={cy - 14} textAnchor="middle" fontSize="30" fontWeight="600" fill="var(--c-text)" style={{ fontVariantNumeric: "tabular-nums", opacity: loading ? 0.5 : 1 }}>
          {epsilon == null ? "—" : epsilon < 10 ? epsilon.toFixed(2) : epsilon.toFixed(1)}
        </text>
        <text x={cx} y={cy + 6} textAnchor="middle" fontSize="10" fill="var(--c-muted)">
          ε after training
        </text>
      </svg>
    </div>
  );
}
