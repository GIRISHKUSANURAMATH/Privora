import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, type Experiment } from "./api";
import { useToast } from "../components/ui";
import { TYPE_LABEL } from "./format";

/** Poll one experiment while it runs; stops polling when it reaches a terminal state. */
export function useExperiment(id: string | null) {
  return useQuery({
    queryKey: ["experiment", id],
    queryFn: () => api.experiment(id as string),
    enabled: !!id,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "running" || s === "queued" ? 1000 : false;
    },
  });
}

/** Submit an experiment, then track it. Shows toasts on start, completion and failure. */
export function useRunner(storageKey: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const [id, setId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(storageKey);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      if (id) sessionStorage.setItem(storageKey, id);
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [id, storageKey]);

  const exp = useExperiment(id);
  const submit = useMutation({
    mutationFn: (body: unknown) => api.createExperiment(body),
    onSuccess: (e) => {
      setId(e.id);
      qc.invalidateQueries({ queryKey: ["experiments"] });
      toast({ tone: "info", title: `${TYPE_LABEL[e.type]} started`, body: "Progress is shown below. You can leave this page; the job keeps running." });
    },
    onError: (err) => toast({ tone: "error", title: "Couldn't start the experiment", body: (err as Error).message }),
  });

  const status = exp.data?.status;
  const prev = useRef<string | undefined>(undefined);
  useEffect(() => {
    const was = prev.current;
    prev.current = status;
    if (!exp.data || !(was === "running" || was === "queued")) return;
    if (status === "completed") {
      toast({ tone: "success", title: `${exp.data.name} completed`, body: exp.data.duration_s ? `Finished in ${exp.data.duration_s.toFixed(1)} s` : undefined });
      qc.invalidateQueries({ queryKey: ["experiments"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["models"] });
    } else if (status === "failed") {
      toast({ tone: "error", title: `${exp.data.name} failed`, body: exp.data.error ?? undefined });
      qc.invalidateQueries({ queryKey: ["experiments"] });
    }
  }, [status, exp.data, qc, toast]);

  return { id, setId, exp: exp.data as Experiment | undefined, loading: exp.isLoading, submit };
}
