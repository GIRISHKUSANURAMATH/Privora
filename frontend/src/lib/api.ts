/* Typed client for the Privora FastAPI backend. All data shown in the UI comes from here. */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError(0, "Can't reach the backend. Start it with run.ps1 and check that it is listening on port 8000.");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    let msg = (body && typeof body === "object" && "detail" in body ? String((body as { detail: unknown }).detail) : "") || res.statusText;
    const errs = body && typeof body === "object" && "errors" in body ? (body as { errors: { loc: unknown[]; msg: string }[] }).errors : null;
    if (errs?.length) msg += ": " + errs.map((e) => `${e.loc.slice(1).join(".")} ${e.msg}`).join("; ");
    throw new ApiError(res.status, msg);
  }
  return body as T;
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

/* ------------------------------------------------------------------ types */
export interface Dataset {
  id: string;
  name: string;
  source: "synthetic" | "upload" | "derived";
  description: string | null;
  original_filename: string | null;
  rows: number;
  columns: number;
  target_hint: string | null;
  parent_id: string | null;
  created_at: string;
}

export interface ColumnStat {
  name: string;
  dtype: string;
  kind: "numeric" | "categorical" | "text" | "boolean" | "datetime";
  missing: number;
  missing_pct: number;
  unique: number;
  unique_ratio: number;
  mean?: number | null;
  std?: number | null;
  min?: number | null;
  max?: number | null;
  median?: number | null;
  histogram?: { counts: number[]; edges: number[] };
  top_values?: { value: string; count: number }[];
}

export interface Profile {
  rows: number;
  columns: number;
  duplicate_rows: number;
  missing_cells: number;
  memory_kb: number;
  quality: { score: number; completeness: number; uniqueness: number; validity: number; issues: string[] };
  column_stats: ColumnStat[];
}

export type Row = Record<string, string | number | boolean | null>;

export interface DatasetDetail extends Dataset {
  profile: Profile;
  preview: Row[];
}

export interface Finding {
  column: string;
  category: "direct_identifier" | "quasi_identifier" | "sensitive_attribute" | "non_sensitive";
  pii_types: string[];
  confidence: number;
  match_rate: number;
  unique_ratio: number;
  evidence: string[];
  recommended_action: Action;
  risk: "low" | "medium" | "high";
}

export interface KAnon {
  quasi_identifiers: string[];
  k: number | null;
  classes: number;
  unique_records: number;
  unique_pct: number;
  class_size_distribution: { bucket: string; records: number }[];
}

export interface PiiScan {
  findings: Finding[];
  summary: {
    direct_identifiers: string[];
    quasi_identifiers: string[];
    sensitive_attributes: string[];
    risk_score: number;
    risk_level: "low" | "medium" | "high";
  };
  k_anonymity: KAnon;
  disclaimer: string;
}

export type Action = "keep" | "suppress" | "redact" | "mask" | "pseudonymize" | "generalize" | "local_dp";

export interface Rule {
  column: string;
  action: Action;
  bin_width?: number | null;
  keep_chars?: number;
  epsilon?: number;
}

export interface TransformReport {
  applied: { column: string; action: Action; changed_pct: number; [k: string]: unknown }[];
  columns_before: string[];
  columns_after: string[];
  k_anonymity_before: KAnon;
  k_anonymity_after: KAnon;
  sample_before: Row[];
  sample_after: Row[];
}

export interface Metrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  roc_auc: number | null;
  loss: number;
  confusion_matrix: number[][];
  n: number;
}

export interface History {
  epoch: number[];
  train_loss: number[];
  test_accuracy: number[];
  epsilon: number[];
}

export interface PrivacyInfo {
  guarantee: string;
  epsilon: number | null;
  target_epsilon?: number | null;
  delta: number | null;
  noise_multiplier: number | null;
  max_grad_norm?: number;
  noise_std?: number;
  sample_rate?: number;
  steps?: number;
  epochs?: number;
  n_train?: number;
  sampling?: string;
  accountant?: string;
  accountant_info?: { name: string; reference: string; rigour: string };
  clip_fraction_per_epoch?: number[];
  assumptions?: string[];
  mode?: string;
  clip_norm?: number | null;
  client_sampling?: string;
}

export interface AttackMetrics {
  accuracy: number;
  balanced_accuracy: number;
  precision: number;
  recall: number;
  fpr: number;
  roc_auc: number | null;
  advantage: number;
  tpr_at_1pct_fpr: number;
  tpr_at_10pct_fpr: number;
  threshold: number;
  roc: { fpr: number; tpr: number }[];
  /** Heuristic from one training run; not a valid DP audit bound. */
  attack_implied_epsilon: number;
  n_eval: number;
  n_shadow_models?: number;
}

export interface MIA {
  attacks: Record<string, AttackMetrics>;
  best_attack_auc: number | null;
  max_attack_implied_epsilon: number;
  confidence_hist: { bins: number[]; members: number[]; non_members: number[] };
  loss_hist: { bins: number[]; members: number[]; non_members: number[] };
  mean_confidence: { members: number; non_members: number };
  mean_loss: { members: number; non_members: number };
  n_members: number;
}

export interface Leakage {
  generalization_gap: number;
  train_accuracy: number;
  test_accuracy: number;
  loss_ratio_test_over_train: number;
  confidence_gap: number;
  max_membership_advantage: number;
  best_attack_auc: number;
  leakage_level: "low" | "moderate" | "high";
}

export interface ModelResult {
  label: string;
  kind: "conventional" | "dp" | "federated";
  model_id: string;
  test: Metrics;
  train?: Metrics;
  history?: History;
  train_seconds: number;
  parameters: number;
  privacy: PrivacyInfo | null;
  attack?: MIA;
  leakage?: Leakage;
  attribute_inference?: {
    attribute: string;
    members: { accuracy: number; baseline: number; advantage: number; n: number };
    non_members: { accuracy: number; baseline: number; advantage: number; n: number };
  };
}

export interface FedRound {
  round: number;
  participants: number[];
  global_accuracy: number;
  global_f1: number;
  global_loss: number;
  mean_local_loss: number | null;
  update_norm: number;
  clipped_updates: number;
  epsilon: number | null;
  client_accuracy: { client: number; accuracy: number; n: number; participated: boolean }[];
}

export interface FedResult {
  seconds: number;
  rounds: FedRound[];
  final: Metrics;
  clients: { client: number; n: number; rounds_participated: number; label_distribution: number[]; final_accuracy: number | null; epsilon: number | null }[];
  communication: { parameters: number; bytes_per_model: number; total_upload_bytes: number; total_download_bytes: number; client_updates: number };
  privacy: PrivacyInfo;
  model_id: string;
}

export interface DataSummary {
  n_train: number;
  n_test: number;
  n_features: number;
  features_used: string[];
  excluded: string[];
  classes: string[];
  class_balance_train: number[];
}

export interface Results {
  data?: DataSummary;
  models?: ModelResult[];
  utility_cost?: Record<string, number | null>;
  curve?: { target_epsilon: number; epsilon: number; noise_multiplier: number; accuracy: number; f1: number; roc_auc: number | null; train_seconds: number }[];
  baseline_accuracy?: number;
  federated?: FedResult;
  setup?: { members: number; non_member_pool: number; shadow_pool: number; shadow_models: number; attribute: string | null; threat_model: string };
  scan_before?: PiiScan;
  scan_after?: PiiScan;
  transform?: TransformReport;
  derived_dataset_id?: string;
  rules?: Rule[];
  utility?: { original: ModelResult; protected: ModelResult; accuracy_change: number };
}

export type ExpType = "baseline" | "dp" | "comparison" | "budget_sweep" | "federated" | "attack" | "pii";
export type ExpStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface Experiment {
  id: string;
  type: ExpType;
  name: string;
  status: ExpStatus;
  progress: number;
  message: string | null;
  dataset_id: string | null;
  config: Record<string, unknown>;
  results?: Results | null;
  live: Record<string, number | null> | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_s: number | null;
  headline?: { accuracy?: number | null; epsilon?: number | null; attack_auc?: Record<string, number>; risk_before?: number; risk_after?: number } | null;
}

export interface Dashboard {
  totals: { experiments: number; completed: number; running: number; failed: number; models: number; dp_models: number; datasets: number; reports: number; federated_clients: number };
  by_type: Record<string, number>;
  privacy_budget: { min_epsilon: number | null; max_epsilon: number | null; median_epsilon: number | null; unit: "example"; client_level_models: number };
  model_points: { model_id: string; label: string; kind: string; experiment_id: string; accuracy: number | null; f1: number | null; epsilon: number | null; privacy_unit: "example" | "client" | null; created_at: string }[];
  attacks: { experiment_id: string; label: string; auc: number | null; epsilon: number | null }[];
  recent: Experiment[];
  recent_reports: Report[];
}

export interface Report {
  id: string;
  experiment_id: string;
  title: string;
  created_at: string;
  experiment_type?: ExpType | null;
  experiment_exists?: boolean;
  markdown?: string;
}

export interface CalcResult {
  n: number;
  sample_rate: number;
  steps: number;
  delta: number;
  delta_recommended_max: number;
  delta_ok: boolean;
  noise_multiplier: number;
  epsilon: number;
  accountant: string;
  accountant_info: { name: string; reference: string; rigour: string };
  comparison: Record<string, number | null | string>;
  curve: { step: number; epsilon: number }[];
}

export interface SystemInfo {
  version: string;
  python: string;
  platform: string;
  cpu_count: number;
  memory_gb: number | null;
  torch: string;
  opacus: string;
  sklearn: string;
  numpy: string;
  cuda_available: boolean;
  device: string;
  limits: { max_upload_mb: number; max_rows: number; max_columns: number; max_concurrent_jobs: number };
}

export interface ModelRecord {
  id: string;
  experiment_id: string;
  label: string;
  kind: string;
  metrics: Partial<Metrics>;
  privacy: PrivacyInfo | null;
  created_at: string;
}

/* ------------------------------------------------------------------ endpoints */
export const api = {
  system: () => request<SystemInfo>("/api/system"),
  dashboard: () => request<Dashboard>("/api/dashboard"),
  datasets: () => request<Dataset[]>("/api/datasets"),
  dataset: (id: string) => request<DatasetDetail>(`/api/datasets/${id}`),
  rows: (id: string, offset: number, limit: number) =>
    request<{ total: number; offset: number; rows: Row[]; columns: string[] }>(`/api/datasets/${id}/rows?offset=${offset}&limit=${limit}`),
  catalog: () => request<{ key: string; title: string; description: string; target: string }[]>("/api/datasets/synthetic/catalog"),
  synthetic: (key: string, n: number, seed?: number) =>
    request<Dataset>("/api/datasets/synthetic", { method: "POST", body: JSON.stringify({ key, n, seed }) }),
  upload: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<Dataset>("/api/datasets/upload", { method: "POST", body: fd });
  },
  deleteDataset: (id: string) => request<void>(`/api/datasets/${id}`, { method: "DELETE" }),
  pii: (id: string) => request<PiiScan>(`/api/datasets/${id}/pii`),
  transform: (id: string, rules: Rule[], save: boolean, name?: string) =>
    request<{ report: TransformReport; saved: Dataset | null }>(`/api/datasets/${id}/transform`, {
      method: "POST",
      body: JSON.stringify({ rules, save, name }),
    }),
  exportUrl: (id: string) => `/api/datasets/${id}/export`,
  calculator: (body: { n: number; batch_size: number; epochs: number; delta: number; noise_multiplier?: number | null; target_epsilon?: number | null; accountant: string }) =>
    request<CalcResult>("/api/privacy/calculator", { method: "POST", body: JSON.stringify(body) }),
  experiments: (type?: string) => request<Experiment[]>(`/api/experiments${type ? `?type=${type}` : ""}`),
  experiment: (id: string) => request<Experiment>(`/api/experiments/${id}`),
  createExperiment: (body: unknown) => request<Experiment>("/api/experiments", { method: "POST", body: JSON.stringify(body) }),
  cancel: (id: string) => request<{ cancelled: boolean }>(`/api/experiments/${id}/cancel`, { method: "POST" }),
  deleteExperiment: (id: string) => request<void>(`/api/experiments/${id}`, { method: "DELETE" }),
  models: () => request<ModelRecord[]>("/api/models"),
  evaluateModel: (id: string, dataset_id: string) =>
    request<{ model_id: string; reloaded_from_disk: boolean; note: string; metrics: Metrics }>(`/api/models/${id}/evaluate`, {
      method: "POST",
      body: JSON.stringify({ dataset_id }),
    }),
  reports: () => request<Report[]>("/api/reports"),
  createReport: (expId: string) => request<Report>(`/api/reports/${expId}`, { method: "POST" }),
  deleteReport: (id: string) => request<void>(`/api/reports/${id}`, { method: "DELETE" }),
  reportUrl: (id: string, format: "md" | "html" | "json") => `/api/reports/${id}/download?format=${format}`,
  /** Markdown source of a saved report, for previewing it without generating a new one. */
  reportMarkdown: (id: string) => request<unknown>(`/api/reports/${id}/download?format=md`).then((b) => (typeof b === "string" ? b : JSON.stringify(b, null, 2))),
};
