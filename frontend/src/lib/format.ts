export const pct = (v: number | null | undefined, d = 1) => (v == null || Number.isNaN(v) ? "—" : `${(v * 100).toFixed(d)}%`);
export const fx = (v: number | null | undefined, d = 3) => (v == null || Number.isNaN(v) ? "—" : v.toFixed(d));
export const eps = (v: number | null | undefined) => (v == null ? "∞" : v < 10 ? v.toFixed(2) : v.toFixed(1));
export const int = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString());
export const bytes = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(2)} MB` : `${(b / 1e3).toFixed(1)} kB`);
export const secs = (s: number | null | undefined) => (s == null ? "—" : s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`);

export function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export const TYPE_LABEL: Record<string, string> = {
  baseline: "Conventional",
  dp: "DP-SGD",
  comparison: "Conventional vs DP",
  budget_sweep: "Budget sweep",
  federated: "Federated",
  attack: "Attack evaluation",
  pii: "PII protection",
};

/** Plain-language strength of an epsilon value. Rough community conventions, not a standard. */
export function epsBand(e: number | null | undefined): { label: string; tone: "signal" | "amber" | "rose" | "muted" } {
  if (e == null) return { label: "No formal guarantee", tone: "muted" };
  if (e <= 1) return { label: "Strong", tone: "signal" };
  if (e <= 4) return { label: "Moderate", tone: "signal" };
  if (e <= 10) return { label: "Weak", tone: "amber" };
  return { label: "Very weak", tone: "rose" };
}
