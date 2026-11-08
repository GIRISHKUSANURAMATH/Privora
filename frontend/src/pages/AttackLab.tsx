import { Crosshair, Swords } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../components/Layout";
import { DatasetPicker, ModelParamsForm, ReportButton, RunButton, RunStatus, type DataChoice, type ModelParams } from "../components/shared";
import { Callout, Field, NumberInput, Panel, Slider, Tip } from "../components/ui";
import { AttackView } from "../components/views";
import { useRunner } from "../lib/hooks";

export default function AttackLab() {
  const [data, setData] = useState<DataChoice | null>(null);
  const [epsText, setEpsText] = useState("1, 8");
  const [shadows, setShadows] = useState(3);
  const [members, setMembers] = useState(600);
  const [delta, setDelta] = useState(1e-5);
  // Deliberately over-parameterised and trained long so the conventional target overfits:
  // membership inference needs a generalisation gap to exploit.
  const [model, setModel] = useState<ModelParams>({ hidden: [256, 128], epochs: 120, batch_size: 64, lr: 0.002, optimizer: "adam", seed: 7 });
  const runner = useRunner("run-attack");
  const epsList = epsText
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => x > 0 && x <= 100)
    .slice(0, 6);
  const running = runner.exp?.status === "running" || runner.exp?.status === "queued";

  const start = () =>
    data &&
    runner.submit.mutate({
      type: "attack",
      name: `Membership inference · conventional vs ε ${epsList.join(", ")}`,
      data: { dataset_id: data.dataset_id, target: data.target, max_train_rows: members, test_size: 0.5 },
      model,
      attack: { epsilons: epsList, shadow_models: shadows, max_eval: 1000, delta, max_grad_norm: 1.0 },
    });

  return (
    <div>
      <PageHeader
        icon={<Swords className="size-5" />}
        title="Attack Laboratory"
        description="Train target models, then attack them. Membership inference asks whether an attacker with query access can tell training records from unseen ones; attribute inference asks whether a hidden attribute can be recovered."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Panel title="Targets">
            <div className="space-y-5">
              <DatasetPicker value={data} onChange={setData} />
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label={<>Training set size (members) <Tip>Smaller training sets overfit more and leak more. The rest of the data is split into non-members and the attacker's shadow pool.</Tip></>} htmlFor="mem">
                  <Slider id="mem" label="Members" min={200} max={2000} step={50} value={members} onChange={setMembers} />
                </Field>
                <Field label="DP targets (ε values)" htmlFor="atk-eps" hint="One DP-SGD target per value, attacked the same way.">
                  <input id="atk-eps" value={epsText} onChange={(e) => setEpsText(e.target.value)} className="h-10 w-full rounded-lg border border-line-strong bg-bg-2 px-3 text-sm text-ink outline-none focus:border-indigo focus:ring-2 focus:ring-indigo/30" />
                </Field>
                <Field label={<>Shadow models <Tip>Shokri et al. (2017): the attacker trains look-alike models on its own data, learns what "member" outputs look like, and applies that classifier to the target. 0 disables this attack.</Tip></>} htmlFor="sh">
                  <Slider id="sh" label="Shadow models" min={0} max={6} step={1} value={shadows} onChange={setShadows} />
                </Field>
                <Field label="δ for DP targets" htmlFor="atk-d">
                  <NumberInput id="atk-d" value={delta} min={1e-12} max={0.01} step={1e-6} onChange={setDelta} />
                </Field>
              </div>
            </div>
          </Panel>
          <Panel title="Target architecture" subtitle="Defaults are chosen to overfit, so the conventional target is a realistic worst case.">
            <ModelParamsForm value={model} onChange={setModel} />
          </Panel>
        </div>
        <div className="space-y-6">
          <section className="panel p-5" aria-label="Threat model">
            <div className="flex items-center gap-2 text-[15px] font-semibold text-ink">
              <Crosshair className="size-4 text-rose" aria-hidden /> Threat model
            </div>
            <dl className="mt-4 space-y-3 text-[13px]">
              {[
                ["Access", "Black-box queries returning class probabilities."],
                ["Attacker data", "A disjoint sample from the same distribution (the shadow pool)."],
                ["Evaluation", "Equal numbers of members and non-members, so 50% accuracy and AUC 0.5 mean no leakage."],
                ["Calibration", "Thresholds are fitted on one half of the evaluation set and reported on the other."],
                ["Attacks", `Loss threshold, entropy threshold${shadows ? `, ${shadows} shadow models` : ""}, attribute inference.`],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="font-medium text-ink-2">{k}</dt>
                  <dd className="mt-0.5 text-muted">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-5 border-t border-line pt-4">
              <RunButton onClick={start} loading={runner.submit.isPending} disabled={!data?.target || running || !epsList.length}>
                Run attack evaluation
              </RunButton>
              <p className="mt-2 text-xs text-muted">
                Trains {1 + epsList.length} targets{shadows ? ` and ${shadows * (1 + epsList.length)} shadow models` : ""}. Expect a few minutes on CPU.
              </p>
            </div>
          </section>
          <Callout tone="amber" title="For evaluating your own models">
            Run these attacks only on synthetic data or data you are authorised to test. A low attack score is evidence, not proof, of privacy.
          </Callout>
          {runner.exp && <RunStatus exp={runner.exp} onReset={() => runner.setId(null)} />}
        </div>
      </div>
      {runner.exp?.status === "completed" && runner.exp.results && (
        <div className="mt-8 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink">Findings</h2>
            <ReportButton exp={runner.exp} />
          </div>
          <AttackView r={runner.exp.results} />
        </div>
      )}
    </div>
  );
}
