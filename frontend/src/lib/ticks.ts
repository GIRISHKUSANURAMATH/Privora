/*
 * Axis ticks whose printed labels are exact.
 *
 * Recharts picks "nice" tick positions for data-driven domains, but they are often not round (for
 * example 0.635); a formatter such as `${(v * 100).toFixed(0)}%` then prints "63%" at the 63.5 %
 * position, and the ROC axes printed 0.25 as "0.3". These helpers choose round steps (1, 2 or 5 x 10^k)
 * and keep a step only if every label the chart's own formatter prints equals its tick value.
 */

export type TickFormatter = (v: number) => string;

/** Smallest step of the form 1, 2 or 5 x 10^k that is >= raw. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const exp = Math.floor(Math.log10(raw));
  for (let e = exp; e <= exp + 1; e++) {
    for (const m of [1, 2, 5]) {
      const s = m * 10 ** e;
      if (s >= raw * (1 - 1e-12)) return roundTo(s, e);
    }
  }
  return 10 ** (exp + 1);
}

function decimalsOf(step: number): number {
  return Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
}

function roundTo(v: number, exp: number): number {
  const d = Math.max(0, -exp) + 2;
  return Number(v.toFixed(Math.min(12, d)));
}

/** Ticks from floor(lo/step)*step to ceil(hi/step)*step. */
export function ticksForStep(lo: number, hi: number, step: number): number[] {
  const d = decimalsOf(step) + 1;
  const start = Math.floor(lo / step + 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const out: number[] = [];
  for (let i = 0; start + i * step <= end + step * 1e-9 && i < 1000; i++) out.push(Number((start + i * step).toFixed(d)));
  if (out.length === 1) out.push(Number((start + step).toFixed(d)));
  return out;
}

function shownNumber(label: string): number | null {
  const m = label.replace(/−/g, "-").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * Scale between tick values and printed numbers: 100 for formatters that turn fractions into
 * percentages (0.5 -> "50%"), 1 for formatters that print the value itself (2.74 -> "2.74%").
 */
export function labelScale(fmt: TickFormatter): number {
  const one = fmt(1);
  return one.includes("%") && shownNumber(one) === 100 ? 100 : 1;
}

/** True when the number printed in `label` equals `value` x `scale`. */
export function labelIsExact(value: number, label: string, scale = label.includes("%") ? 100 : 1): boolean {
  const shown = shownNumber(label);
  if (shown === null) return false;
  const target = value * scale;
  return Math.abs(shown - target) <= 1e-9 * Math.max(1, Math.abs(target));
}

/**
 * Round, exactly-labelled ticks covering [lo, hi] with at most `maxTicks` ticks.
 * Starts from the smallest step that fits and widens it until every label is exact.
 */
export function exactTicks(lo: number, hi: number, fmt: TickFormatter = (v) => String(v), maxTicks = 6): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi === lo) {
    const pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.1 : 1;
    lo -= pad;
    hi += pad;
  }
  const scale = labelScale(fmt);
  const first = niceStep((hi - lo) / Math.max(1, maxTicks - 1));
  // Widen only while the axis still spans about the data; a formatter too coarse for the range
  // (e.g. whole percent on 0.1 %) cannot be made exact, and runaway steps would hide the data.
  for (let step = first; step <= (hi - lo) * 1.0000001 || step === first; step = niceStep(step * 1.000001)) {
    const ticks = ticksForStep(lo, hi, step);
    if (ticks.length <= maxTicks && ticks.every((t) => labelIsExact(t, fmt(t), scale))) return ticks;
  }
  return ticksForStep(lo, hi, first);
}

/** Numeric extent of the given keys across rows (ignores null / non-numeric values). */
export function extentOf(rows: Record<string, unknown>[], keys: string[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of rows) {
    for (const k of keys) {
      const v = r[k];
      if (typeof v === "number" && Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

/** Explicit ROC axis ticks: positions and labels coincide (0, 0.2, ..., 1). */
export const ROC_TICKS = [0, 0.2, 0.4, 0.6, 0.8, 1] as const;
export const rocTickLabel: TickFormatter = (v) => v.toFixed(1);

/** Shorten text at a word boundary, never mid-word; adds an ellipsis when shortened. */
export function shortenAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  const head = (at > max * 0.4 ? cut.slice(0, at) : text.slice(0, max)).replace(/[\s··,;:+\-]+$/, "");
  return `${head}…`;
}

/** Greedy word wrap for SVG tick labels, by an estimated character width. */
export function wrapLabel(text: string, maxWidthPx: number, charPx = 6.4, maxLines = 3): string[] {
  const perLine = Math.max(6, Math.floor(maxWidthPx / charPx));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= perLine || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = shortenAtWord(`${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`, perLine);
    return kept;
  }
  // A single word longer than the line is shortened rather than overflowing into its neighbour.
  return lines.map((l) => (l.length > perLine ? shortenAtWord(l, perLine) : l));
}
