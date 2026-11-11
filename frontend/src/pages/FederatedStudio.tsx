import clsx from "clsx";
import { Network, Server } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../components/Layout";
import { DatasetPicker, ModelParamsForm, ReportButton, RunButton, RunStatus, type DataChoice, type ModelParams } from "../components/shared";
import { Callout, Field, NumberInput, Panel, Segmented, Slider, Tip } from "../components/ui";
import { FederatedView } from "../components/views";
import type { Experiment } from "../lib/api";
import { pct } from "../lib/format";
import { useRunner } from "../lib/hooks";

type Privacy = "none" | "client_dp" | "local_dp_sgd";

export default function FederatedStudio() {
  const [data, setData] = useState<DataChoice | null>(null);
  const [clients, setClients] = useState(8);
  const [rounds, setRounds] = useState(15);
  const [frac, setFrac] = useState(0.5);
  const [localEpochs, setLocalEpochs] = useState(2);
  const [lr, setLr] = useState(0.05);
  const [partition, setPartition] = useState<"iid" | "dirichlet">("iid");
  const [alpha, setAlpha] = useState(0.5);
  const [privacy, setPrivacy] = useState<Privacy>("none");
  const [noise, setNoise] = useState(1.0);
  const [clipNorm, setClipNorm] = useState(1.0);
  const [delta, setDelta] = useState(1e-5);
  const [model, setModel] = useState<ModelParams>({ hidden: [64, 32], epochs: 10, batch_size: 64, lr: 0.002, optimizer: "adam", seed: 42 });
  const runner = useRunner("run-fed");
  const running = runner.exp?.status === "running" || runner.exp?.status === "queued";

  const start = () =>
    data &&
    runner.submit.mutate({
      type: "federated",
      name: `FedAvg · ${clients} clients · ${privacy === "none" ? "no DP" : privacy === "client_dp" ? "client-level DP" : "local DP-SGD"}`,
      data: { dataset_id: data.dataset_id, target: data.target },
      model,
      federated: { num_clients: clients, rounds, client_fraction: frac, local_epochs: localEpochs, batch_size: 32, lr, partition, dirichlet_alpha: alpha, privacy, noise_multiplier: noise, clip_norm: clipNorm, delta, local_max_grad_norm: 1.0 },
    });

  return (
    <div>
      <PageHeader
        icon={<Network className="size-5" />}
        title="Federated Learning Studio"
        description="Split the data across simulated clients, train locally, and let a coordinator average their updates with FedAvg. Raw rows never leave a client; updates still can leak, which is what the DP options address."
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Panel title="Data and clients">
            <div className="space-y-5">
              <DatasetPicker value={data} onChange={setData} />
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="Clients" htmlFor="fl-k">
                  <Slider id="fl-k" label="Number of clients" min={2} max={30} step={1} value={clients} onChange={setClients} />
                </Field>
                <Field label="Rounds" htmlFor="fl-r">
                  <Slider id="fl-r" label="Rounds" min={1} max={60} step={1} value={rounds} onChange={setRounds} />
                </Field>
                <Field label={<>Client fraction <Tip>Share of clients selected each round. With client-level DP each client is included independently with this probability (Poisson sampling), which the accountant requires.</Tip></>} htmlFor="fl-f">
                  <Slider id="fl-f" label="Client fraction per round" min={0.1} max={1} step={0.05} value={frac} onChange={setFrac} format={(v) => `${Math.round(v * 100)}%`} />
                </Field>
                <Field label="Local epochs" htmlFor="fl-le">
                  <Slider id="fl-le" label="Local epochs" min={1} max={10} step={1} value={localEpochs} onChange={setLocalEpochs} />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="Partition">
                  <Segmented ariaLabel="Data partition" value={partition} onChange={setPartition} options={[{ value: "iid", label: "IID" }, { value: "dirichlet", label: "Non-IID (Dirichlet)" }]} />
                </Field>
                {partition === "dirichlet" && (
                  <Field label={<>Dirichlet α <Tip>Lower α gives each client a more skewed label mix.</Tip></>} htmlFor="fl-a">
                    <Slider id="fl-a" label="Dirichlet alpha" min={0.1} max={5} step={0.1} value={alpha} onChange={setAlpha} format={(v) => v.toFixed(1)} />
                  </Field>
                )}
                <Field label="Local learning rate (SGD)" htmlFor="fl-lr">
                  <NumberInput id="fl-lr" value={lr} min={0.0001} max={5} step={0.01} onChange={setLr} />
                </Field>
              </div>
            </div>
          </Panel>
          <Panel title="Privacy">
            <div className="space-y-5">
              <Segmented<Privacy>
                ariaLabel="Federated privacy mode"
                value={privacy}
                onChange={setPrivacy}
                options={[
                  { value: "none", label: "None" },
                  { value: "client_dp", label: "Client-level DP" },
                  { value: "local_dp_sgd", label: "Local DP-SGD" },
                ]}
              />
              <p className="text-[13px] leading-relaxed text-ink-2">
                {privacy === "none" && "Plain FedAvg. Useful as a baseline, but there is no formal guarantee: updates can reveal training records."}
                {privacy === "client_dp" && "DP-FedAvg: each client's whole update is clipped to norm S and the server adds Gaussian noise z·S to the sum. Protects whether a client took part at all. Assumes an honest server."}
                {privacy === "local_dp_sgd" && "Each client trains with DP-SGD via Opacus, so its update is example-level private before it leaves the client, even against a curious server. ε is reported per client."}
              </p>
              {privacy !== "none" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label={privacy === "client_dp" ? "Noise multiplier z" : "Noise multiplier σ"} htmlFor="fl-z">
                    <NumberInput id="fl-z" value={noise} min={0.05} max={50} step={0.1} onChange={setNoise} />
                  </Field>
                  {privacy === "client_dp" && (
                    <Field label="Update clip S" htmlFor="fl-s">
                      <NumberInput id="fl-s" value={clipNorm} min={0.01} max={100} step={0.1} onChange={setClipNorm} />
                    </Field>
                  )}
                  <Field label="δ" htmlFor="fl-d">
                    <NumberInput id="fl-d" value={delta} min={1e-12} max={0.1} step={1e-6} onChange={setDelta} />
                  </Field>
                </div>
              )}
              {privacy === "client_dp" && clients < 50 && (
                <Callout tone="amber">With only {clients} clients the noise is large relative to the averaged signal, so expect a big accuracy drop. Client-level DP is designed for thousands of clients.</Callout>
              )}
            </div>
          </Panel>
          <Panel title="Centralized reference model" subtitle="Trained once on the pooled data for comparison; the same architecture is used for the federated model.">
            <ModelParamsForm value={model} onChange={setModel} />
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Topology" subtitle={runner.exp?.status === "running" ? "Live" : "Configured network"}>
            <Topology clients={clients} frac={frac} exp={runner.exp} />
            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <RunButton onClick={start} loading={runner.submit.isPending} disabled={!data?.target || running}>
                Start federated training
              </RunButton>
              <p className="text-xs text-muted">
                {rounds} rounds × ~{Math.max(1, Math.round(frac * clients))} clients × {localEpochs} local epochs
              </p>
            </div>
          </Panel>
          {runner.exp && <RunStatus exp={runner.exp} onReset={() => runner.setId(null)} />}
        </div>
      </div>
      {runner.exp?.status === "completed" && runner.exp.results && (
        <div className="mt-8 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink">Results</h2>
            <ReportButton exp={runner.exp} />
          </div>
          <FederatedView r={runner.exp.results} />
        </div>
      )}
    </div>
  );
}

/** Coordinator in the centre, clients on a ring. Real participation and accuracy appear once a run exists. */
function Topology({ clients, frac, exp }: { clients: number; frac: number; exp?: Experiment }) {
  const fed = exp?.status === "completed" ? exp.results?.federated : undefined;
  const last = fed?.rounds[fed.rounds.length - 1];
  const n = fed ? fed.clients.length : clients;
  const size = 340;
  const c = size / 2;
  const R = 130;
  const liveRound = exp?.status === "running" ? exp.live?.round : null;
  return (
    <div className="flex flex-col items-center">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[380px]" role="img" aria-label={`Federated topology with ${n} clients${last ? `, final round participants ${last.participants.map((p) => p + 1).join(", ")}` : ""}`}>
        {Array.from({ length: n }, (_, i) => {
          const a = (2 * Math.PI * i) / n - Math.PI / 2;
          const x = c + R * Math.cos(a);
          const y = c + R * Math.sin(a);
          const on = last ? last.participants.includes(i) : i < Math.round(frac * n);
          const acc = fed?.clients[i]?.final_accuracy;
          return (
            <g key={i}>
              <line x1={c} y1={c} x2={x} y2={y} stroke={on ? "var(--c-signal)" : "var(--c-line)"} strokeWidth={on ? 1.6 : 1} strokeDasharray={on ? undefined : "3 4"} opacity={on ? 0.8 : 1}>
                {liveRound != null && on && <animate attributeName="stroke-dashoffset" from="0" to="-14" dur="1s" repeatCount="indefinite" />}
              </line>
              <circle cx={x} cy={y} r={15} fill="var(--c-raised)" stroke={on ? "var(--c-signal)" : "var(--c-line-strong)"} strokeWidth="1.5" />
              <text x={x} y={y + 4} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--c-text)">
                {i + 1}
              </text>
              {acc != null && n <= 16 && (
                <text x={c + (R + 30) * Math.cos(a)} y={c + (R + 30) * Math.sin(a) + 3} textAnchor="middle" fontSize="9" fill="var(--c-muted)">
                  {pct(acc, 0)}
                </text>
              )}
            </g>
          );
        })}
        <circle cx={c} cy={c} r={30} fill="var(--c-surface)" stroke="var(--c-indigo)" strokeWidth="2" />
        <foreignObject x={c - 12} y={c - 18} width="24" height="24">
          <Server className="size-6 text-indigo" />
        </foreignObject>
        <text x={c} y={c + 18} textAnchor="middle" fontSize="8" fill="var(--c-muted)">
          FedAvg
        </text>
      </svg>
      <div className="mt-2 flex flex-wrap justify-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-2 border-signal" aria-hidden />
          {fed ? "participated in final round" : "selected per round (approx.)"}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-2 border-line-strong" aria-hidden /> idle
        </span>
        {fed && <span>labels: client accuracy on its own data</span>}
      </div>
      <p className={clsx("mt-3 text-center text-[13px]", fed ? "text-ink-2" : "text-muted")}>
        {fed ? `Global accuracy after ${fed.rounds.length} rounds: ${pct(fed.final.accuracy)}` : "Run the simulation to see real participation and per-client accuracy."}
      </p>
    </div>
  );
}
