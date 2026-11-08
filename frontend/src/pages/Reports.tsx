import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Trash2 } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../components/Layout";
import { DownloadLink } from "../components/shared";
import { Button, Confirm, Empty, Field, Panel, Select, Spinner, useToast } from "../components/ui";
import { api } from "../lib/api";
import { ago, TYPE_LABEL } from "../lib/format";

export default function Reports() {
  const reports = useQuery({ queryKey: ["reports"], queryFn: api.reports });
  const exps = useQuery({ queryKey: ["experiments"], queryFn: () => api.experiments() });
  const completed = (exps.data ?? []).filter((e) => e.status === "completed");
  const [sel, setSel] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const gen = useMutation({
    mutationFn: (id: string) => api.createReport(id),
    onSuccess: (r) => {
      setPreview(r.markdown ?? null);
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast({ tone: "success", title: "Report generated", body: r.title });
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't generate the report", body: (e as Error).message }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteReport(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast({ tone: "success", title: "Report deleted" });
    },
  });
  const target = sel || completed[0]?.id || "";

  return (
    <div>
      <PageHeader icon={<FileText className="size-5" />} title="Privacy Reports" description="Reproducible write-ups of completed experiments: configuration, metrics, privacy accounting and stated assumptions, built from stored results. Download as Markdown, standalone HTML or raw JSON." />
      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <div className="space-y-6">
          <Panel title="Generate a report">
            {completed.length ? (
              <div className="space-y-4">
                <Field label="Experiment" htmlFor="rep-exp">
                  <Select id="rep-exp" value={target} onChange={setSel} options={completed.map((e) => ({ value: e.id, label: `${e.name} (${TYPE_LABEL[e.type]})` }))} />
                </Field>
                <Button variant="primary" icon={<FileText className="size-4" />} loading={gen.isPending} onClick={() => gen.mutate(target)}>
                  Generate report
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted">Reports can be generated once an experiment has completed.</p>
            )}
          </Panel>
          <Panel title="Saved reports" bodyClass="p-2">
            {reports.isLoading && <Spinner />}
            {reports.data?.length === 0 && <Empty icon={<FileText className="size-5" />} title="No reports yet" body="Generate one from a completed experiment." />}
            <ul className="space-y-1">
              {reports.data?.map((r) => (
                <li key={r.id} className="rounded-lg px-3 py-2.5 hover:bg-raised">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{r.title}</p>
                      <p className="text-xs text-muted">
                        {r.experiment_type ? TYPE_LABEL[r.experiment_type] : "experiment deleted"} · {ago(r.created_at)}
                      </p>
                    </div>
                    <button aria-label={`Delete report ${r.title}`} className="rounded p-1 text-muted hover:text-rose" onClick={() => setDel(r.id)}>
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  {r.experiment_exists && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <DownloadLink href={api.reportUrl(r.id, "html")}>HTML</DownloadLink>
                      <DownloadLink href={api.reportUrl(r.id, "md")}>Markdown</DownloadLink>
                      <DownloadLink href={api.reportUrl(r.id, "json")}>JSON</DownloadLink>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <Panel title="Preview" subtitle={preview ? "Markdown source of the latest generated report" : undefined}>
          {preview ? (
            <pre tabIndex={0} aria-label="Report preview" className="scrollbar-thin max-h-[75vh] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-bg-2 p-4 font-mono text-xs leading-relaxed text-ink-2">{preview}</pre>
          ) : (
            <Empty icon={<FileText className="size-5" />} title="Nothing to preview" body="Generate a report to preview its contents here." />
          )}
        </Panel>
      </div>
      <Confirm open={!!del} danger title="Delete this report?" body="The report file is removed. The experiment and its results are kept, so you can regenerate it." confirmLabel="Delete report" onConfirm={() => del && remove.mutate(del)} onClose={() => setDel(null)} />
    </div>
  );
}
