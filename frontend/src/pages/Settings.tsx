import { useQuery } from "@tanstack/react-query";
import { Cpu, Settings as Gear } from "lucide-react";
import { PageHeader } from "../components/Layout";
import { Badge, Button, ErrorNote, KV, Panel, Segmented, Spinner, useToast } from "../components/ui";
import { api } from "../lib/api";
import { useTheme } from "../lib/theme";

export default function Settings() {
  const sys = useQuery({ queryKey: ["system"], queryFn: api.system });
  const { theme, setTheme } = useTheme();
  const toast = useToast();
  return (
    <div>
      <PageHeader icon={<Gear className="size-5" />} title="Settings" description="Appearance, the runtime this backend is using, and the safety limits applied to uploads and jobs. Limits are set with PPML_* environment variables (see .env.example)." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Appearance">
          <div className="space-y-4">
            <Segmented ariaLabel="Theme" value={theme} onChange={setTheme} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
            <p className="text-[13px] text-muted">Saved in this browser only. Charts re-read the palette when the theme changes.</p>
          </div>
        </Panel>
        <Panel title="Local state">
          <p className="text-[13px] leading-relaxed text-ink-2">Studios remember the last job you started in this tab so you can navigate away and come back. Clear that if a studio shows an old run.</p>
          <Button
            className="mt-4"
            size="sm"
            onClick={() => {
              try {
                ["run-dp", "run-fed", "run-attack", "run-baseline"].forEach((k) => sessionStorage.removeItem(k));
                Object.keys(sessionStorage).filter((k) => k.startsWith("run-pii")).forEach((k) => sessionStorage.removeItem(k));
              } catch {
                /* ignore */
              }
              toast({ tone: "success", title: "Studio state cleared" });
            }}
          >
            Clear studio state
          </Button>
        </Panel>
        <Panel title="Runtime" actions={sys.data && <Badge tone={sys.data.cuda_available ? "signal" : "blue"} dot>{sys.data.device.toUpperCase()}</Badge>}>
          {sys.isLoading && <Spinner />}
          {sys.error && <ErrorNote error={sys.error} />}
          {sys.data && (
            <KV
              items={[
                ["Privora", sys.data.version],
                ["Python", sys.data.python],
                ["PyTorch", sys.data.torch],
                ["Opacus", sys.data.opacus],
                ["scikit-learn", sys.data.sklearn],
                ["NumPy", sys.data.numpy],
                ["Platform", <span className="text-ink-2">{sys.data.platform}</span>],
                ["CPU cores", sys.data.cpu_count],
                ["Memory", sys.data.memory_gb ? `${sys.data.memory_gb} GB` : "not reported on this OS"],
                ["CUDA available", sys.data.cuda_available ? "yes" : "no — CPU training"],
              ]}
            />
          )}
        </Panel>
        <Panel title="Safety limits" actions={<Cpu className="size-4 text-muted" aria-hidden />}>
          {sys.data && (
            <KV
              items={[
                ["Max upload size", `${sys.data.limits.max_upload_mb} MB`],
                ["Max rows", sys.data.limits.max_rows.toLocaleString()],
                ["Max columns", sys.data.limits.max_columns],
                ["Concurrent jobs", sys.data.limits.max_concurrent_jobs],
                ["Allowed uploads", ".csv .tsv .txt (UTF-8)"],
                ["Model loading", "torch.load(weights_only=True)"],
              ]}
            />
          )}
        </Panel>
      </div>
    </div>
  );
}
