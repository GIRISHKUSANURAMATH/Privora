import { type ReactNode, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { exactTicks, extentOf, ROC_TICKS, rocTickLabel, type TickFormatter, wrapLabel } from "../lib/ticks";
import { useChartColors } from "../lib/theme";

const TICK_FONT_PX = 11;
const TICK_LINE_PX = 13;
/* X axis band tall enough for tick labels plus an axis title, so the legend below never meets it. */
const AXIS_TITLE_H = 46;

export function ChartFrame({ label, height = 260, children, summary, note, onWidth }: { label: string; height?: number; children: ReactNode; summary?: string; note?: ReactNode; onWidth?: (w: number) => void }) {
  return (
    <figure aria-label={label} className="w-full min-w-0 overflow-x-clip">
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%" onResize={onWidth ? (w) => onWidth(w) : undefined}>
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
      {note && <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-muted">{note}</div>}
      <figcaption className="sr-only">{summary ?? label}</figcaption>
    </figure>
  );
}

/* A reference line is explained below the plot instead of inside it, where data points could cover it. */
function RefNote({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="18" height="6" aria-hidden>
        <line x1="0" y1="3" x2="18" y2="3" stroke={color} strokeWidth="1.5" strokeDasharray="4 3" />
      </svg>
      {label}
    </span>
  );
}

/* Category tick that wraps onto several lines inside its own band, so neighbouring labels never touch. */
/* Average glyph width as a share of the font size for the UI sans-serif at 9-11 px. */
const CHAR_EM = 0.58;

/** Font size and wrapped lines for category labels that must each fit one band of `bandWidth` px. */
export function categoryLayout(labels: string[], bandWidth: number): { fontPx: number; lines: string[][] } {
  const room = Math.max(24, bandWidth - 8);
  const longestWord = Math.max(1, ...labels.flatMap((l) => l.split(/\s+/).map((w) => w.length)));
  // Shrink (down to 9 px) until the longest single word fits, so words are wrapped, not cut.
  const fontPx = Math.max(9, Math.min(TICK_FONT_PX, Math.floor(room / (longestWord * CHAR_EM))));
  return { fontPx, lines: labels.map((l) => wrapLabel(l, room, fontPx * CHAR_EM)) };
}

function WrappedTick(props: { x?: number; y?: number; index?: number; layout: { fontPx: number; lines: string[][] }; fill: string }) {
  const { x = 0, y = 0, index = 0, layout, fill } = props;
  const lines = layout.lines[index] ?? [];
  const lineH = Math.round(layout.fontPx * 1.2);
  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="middle" fill={fill} fontSize={layout.fontPx}>
        {lines.map((l, i) => (
          <tspan key={i} x={0} dy={i === 0 ? layout.fontPx + 1 : lineH}>
            {l}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function useTooltipStyle() {
  const c = useChartColors();
  return {
    contentStyle: { background: c.surface, border: `1px solid ${c.line}`, borderRadius: 10, fontSize: 12, color: c.text, boxShadow: "0 12px 30px -12px rgba(0,0,0,.5)" },
    labelStyle: { color: c.muted, marginBottom: 4 },
    itemStyle: { padding: 0 },
    cursor: { stroke: c.line, strokeWidth: 1 },
  };
}

export type SeriesDef = { key: string; name: string; color: string; dashed?: boolean; dot?: boolean };
type DomainEnd = number | "auto" | "dataMin" | "dataMax";

/* Numeric ticks for a value axis: the caller's fixed domain if fully numeric, else the data extent. */
function valueTicks(rows: Record<string, unknown>[], keys: string[], domain: [DomainEnd, DomainEnd] | undefined, fmt: TickFormatter | undefined, extra: number[] = [], zeroBased = false): number[] {
  const f = fmt ?? ((v: number) => String(v));
  if (domain && typeof domain[0] === "number" && typeof domain[1] === "number") return exactTicks(domain[0], domain[1], f);
  const ext = extentOf(rows, keys);
  const vals = [...(ext ?? []), ...extra];
  if (!vals.length) return exactTicks(0, 1, f);
  let lo = Math.min(...vals);
  const hi = Math.max(...vals);
  if (zeroBased || (domain && domain[0] === 0)) lo = Math.min(0, lo);
  return exactTicks(lo, hi, f);
}

export function Lines({ data, xKey, series, label, height, yDomain, yFmt, xLabel, yLabel, summary, refY }: {
  data: Record<string, unknown>[];
  xKey: string;
  series: SeriesDef[];
  label: string;
  height?: number;
  yDomain?: [DomainEnd, DomainEnd];
  yFmt?: TickFormatter;
  xLabel?: string;
  yLabel?: string;
  summary?: string;
  refY?: { y: number; label: string; color: string };
}) {
  const tt = useTooltipStyle();
  const c = useChartColors();
  const ticks = valueTicks(data, series.map((s) => s.key), yDomain, yFmt, refY ? [refY.y] : []);
  return (
    <ChartFrame label={label} height={height} summary={summary} note={refY ? <RefNote label={refY.label} color={refY.color} /> : undefined}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: c.line }} padding={{ left: 12, right: 12 }} height={xLabel ? AXIS_TITLE_H : 30} label={xLabel ? { value: xLabel, position: "insideBottom", offset: 2, fill: c.muted, fontSize: 11 } : undefined} />
        <YAxis domain={[ticks[0], ticks[ticks.length - 1]]} ticks={ticks} interval={0} tickFormatter={yFmt} tickLine={false} axisLine={false} width={48} label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", fill: c.muted, fontSize: 11, dx: 8 } : undefined} />
        <Tooltip {...tt} formatter={(v: number) => (yFmt ? yFmt(v) : typeof v === "number" ? v.toFixed(4) : v)} />
        {series.length > 1 && <Legend iconType="plainline" wrapperStyle={{ paddingTop: 8 }} />}
        {refY && <ReferenceLine y={refY.y} stroke={refY.color} strokeDasharray="4 4" />}
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "5 4" : undefined} dot={s.dot ? { r: 3, strokeWidth: 0, fill: s.color } : false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
        ))}
      </LineChart>
    </ChartFrame>
  );
}

export function Bars({ data, xKey, series, label, height, yFmt, yDomain, summary, stacked, layout = "horizontal", labelEvery = 1 }: {
  data: Record<string, unknown>[];
  xKey: string;
  series: SeriesDef[];
  label: string;
  height?: number;
  yFmt?: TickFormatter;
  yDomain?: [number, number];
  summary?: string;
  stacked?: boolean;
  layout?: "horizontal" | "vertical";
  /** Label only every n-th category (histograms with many bins); a label may then use n bands. */
  labelEvery?: number;
}) {
  const tt = useTooltipStyle();
  const c = useChartColors();
  const [width, setWidth] = useState(0);
  const vertical = layout === "vertical";
  const keys = series.map((s) => s.key);
  const stackedRows = stacked ? data.map((r) => ({ __sum: keys.reduce((a, k) => a + (typeof r[k] === "number" ? (r[k] as number) : 0), 0) })) : data;
  const ticks = valueTicks(stackedRows, stacked ? ["__sum"] : keys, yDomain ?? [0, "auto"], yFmt, [], true);
  // Category labels wrap inside their band; the axis grows by one line per wrapped line.
  const yAxisWidth = 48;
  const band = data.length && width ? (width - yAxisWidth - 16) / data.length : 100;
  const every = Math.max(1, Math.round(labelEvery));
  const cats = categoryLayout(data.map((r, i) => (i % every === 0 ? String(r[xKey] ?? "") : "")), band * every);
  const lineCount = Math.max(1, ...cats.lines.map((l) => l.length));
  return (
    <ChartFrame label={label} height={(height ?? 260) + (lineCount - 1) * TICK_LINE_PX} summary={summary} onWidth={vertical ? undefined : setWidth}>
      <BarChart data={data} layout={layout} margin={{ top: 8, right: 16, bottom: 4, left: vertical ? 8 : 0 }} barGap={3}>
        <CartesianGrid strokeDasharray="3 3" vertical={vertical} horizontal={!vertical} />
        {vertical ? (
          <>
            <XAxis type="number" domain={[ticks[0], ticks[ticks.length - 1]]} ticks={ticks} interval={0} tickFormatter={yFmt} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey={xKey} tickLine={false} axisLine={{ stroke: c.line }} width={110} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: c.line }} interval={0} height={8 + lineCount * TICK_LINE_PX} tick={<WrappedTick layout={cats} fill={c.muted} />} />
            <YAxis domain={[ticks[0], ticks[ticks.length - 1]]} ticks={ticks} interval={0} tickFormatter={yFmt} tickLine={false} axisLine={false} width={yAxisWidth} />
          </>
        )}
        <Tooltip {...tt} cursor={{ fill: c.line, opacity: 0.35 }} formatter={(v: number) => (yFmt ? yFmt(v) : v)} />
        {series.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ paddingTop: 8 }} />}
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={36} stackId={stacked ? "a" : undefined} isAnimationActive={false} />
        ))}
      </BarChart>
    </ChartFrame>
  );
}

export function ROC({ curves, label, height = 300 }: { curves: { name: string; color: string; points: { fpr: number; tpr: number }[] }[]; label: string; height?: number }) {
  const tt = useTooltipStyle();
  const c = useChartColors();
  const ticks = [...ROC_TICKS];
  return (
    <ChartFrame label={label} height={height} summary={`${label}. ${curves.map((x) => x.name).join(", ")}. Diagonal line is random guessing.`}>
      <LineChart margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" dataKey="fpr" domain={[0, 1]} ticks={ticks} interval={0} tickFormatter={rocTickLabel} tickLine={false} axisLine={{ stroke: c.line }} height={AXIS_TITLE_H} label={{ value: "False positive rate", position: "insideBottom", offset: 2, fill: c.muted, fontSize: 11 }} allowDuplicatedCategory={false} />
        <YAxis type="number" domain={[0, 1]} ticks={ticks} interval={0} tickFormatter={rocTickLabel} tickLine={false} axisLine={false} width={58} label={{ value: "True positive rate", angle: -90, position: "insideLeft", fill: c.muted, fontSize: 11, dx: 4, dy: 50 }} />
        <Tooltip {...tt} formatter={(v: number) => v.toFixed(3)} labelFormatter={(v) => `FPR ${Number(v).toFixed(3)}`} />
        <Legend iconType="plainline" wrapperStyle={{ paddingTop: 4 }} />
        <Line data={[{ fpr: 0, tpr: 0 }, { fpr: 1, tpr: 1 }]} dataKey="tpr" name="Random guess" stroke={c.muted} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
        {curves.map((cv) => (
          <Line key={cv.name} data={cv.points} dataKey="tpr" name={cv.name} stroke={cv.color} strokeWidth={2} dot={false} type="stepAfter" isAnimationActive={false} />
        ))}
      </LineChart>
    </ChartFrame>
  );
}

const pctTick: TickFormatter = (v) => `${(v * 100).toFixed(0)}%`;

export function PrivacyUtility({ points, baseline, label, height = 300, connect = true }: { points: { epsilon: number; accuracy: number; name: string }[]; baseline?: number; label: string; height?: number; connect?: boolean }) {
  const tt = useTooltipStyle();
  const c = useChartColors();
  const sorted = [...points].sort((a, b) => a.epsilon - b.epsilon);
  const lo = sorted[0]?.epsilon ?? 0.1;
  const hi = sorted[sorted.length - 1]?.epsilon ?? 10;
  const ticks = [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64].filter((t) => t >= lo / 1.5 && t <= hi * 1.5);
  const accs = sorted.map((p) => p.accuracy).concat(baseline != null ? [baseline] : []);
  const yTicks = exactTicks(Math.min(...accs, 1), Math.max(...accs, 0), pctTick);
  return (
    <ChartFrame label={label} height={height} summary={`${label}: ${points.map((p) => `ε ${p.epsilon.toFixed(2)} → accuracy ${(p.accuracy * 100).toFixed(1)}%`).join("; ")}`} note={baseline != null ? <RefNote label="Non-private (best conventional model)" color={c.blue} /> : undefined}>
      <ScatterChart margin={{ top: 8, right: 20, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" dataKey="epsilon" name="ε" scale="log" domain={[Math.min(lo, ticks[0] ?? lo) * 0.9, Math.max(hi, ticks[ticks.length - 1] ?? hi) * 1.1]} ticks={ticks} tickFormatter={(v) => String(Number(v))} tickLine={false} axisLine={{ stroke: c.line }} height={AXIS_TITLE_H} label={{ value: "Privacy budget ε (log scale, lower = more private)", position: "insideBottom", offset: 2, fill: c.muted, fontSize: 11 }} />
        <YAxis type="number" dataKey="accuracy" name="Accuracy" domain={[yTicks[0], yTicks[yTicks.length - 1]]} ticks={yTicks} interval={0} tickFormatter={pctTick} tickLine={false} axisLine={false} width={44} />
        <ZAxis range={[70, 70]} />
        <Tooltip {...tt} formatter={(v: number, n: string) => (n === "Accuracy" ? `${(v * 100).toFixed(2)}%` : v.toFixed(3))} />
        {baseline != null && <ReferenceLine y={baseline} stroke={c.blue} strokeDasharray="4 4" />}
        <Scatter data={sorted} fill={c.violet} shape={(props: { cx?: number; cy?: number; payload?: { epsilon: number; accuracy: number; name: string } }) => (
            // Recharts wraps each point in role="img"; a <title> gives it an accessible name.
            <>
              <title>{props.payload ? `${props.payload.name}: ε ${props.payload.epsilon.toFixed(2)}, accuracy ${(props.payload.accuracy * 100).toFixed(1)}%` : "data point"}</title>
              <circle cx={props.cx} cy={props.cy} r={5} fill={c.violet} />
            </>
          )} line={connect ? { stroke: c.violet, strokeWidth: 1.5 } : undefined} isAnimationActive={false} />
      </ScatterChart>
    </ChartFrame>
  );
}
