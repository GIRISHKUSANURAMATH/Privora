import type { ReactNode } from "react";
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
import { useChartColors } from "../lib/theme";

export function ChartFrame({ label, height = 260, children, summary }: { label: string; height?: number; children: ReactNode; summary?: string }) {
  return (
    <figure aria-label={label} className="w-full min-w-0">
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">{summary ?? label}</figcaption>
    </figure>
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

export function Lines({ data, xKey, series, label, height, yDomain, yFmt, xLabel, yLabel, summary, refY }: {
  data: Record<string, unknown>[];
  xKey: string;
  series: SeriesDef[];
  label: string;
  height?: number;
  yDomain?: [number | "auto" | "dataMin" | "dataMax", number | "auto" | "dataMin" | "dataMax"];
  yFmt?: (v: number) => string;
  xLabel?: string;
  yLabel?: string;
  summary?: string;
  refY?: { y: number; label: string; color: string };
}) {
  const tt = useTooltipStyle();
  const c = useChartColors();
  return (
    <ChartFrame label={label} height={height} summary={summary}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: xLabel ? 18 : 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: c.line }} label={xLabel ? { value: xLabel, position: "insideBottom", offset: -10, fill: c.muted, fontSize: 11 } : undefined} />
        <YAxis domain={yDomain ?? ["auto", "auto"]} tickFormatter={yFmt} tickLine={false} axisLine={false} width={48} label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", fill: c.muted, fontSize: 11, dx: 8 } : undefined} />
        <Tooltip {...tt} formatter={(v: number) => (yFmt ? yFmt(v) : typeof v === "number" ? v.toFixed(4) : v)} />
        {series.length > 1 && <Legend iconType="plainline" wrapperStyle={{ paddingTop: 8 }} />}
        {refY && <ReferenceLine y={refY.y} stroke={refY.color} strokeDasharray="4 4" label={{ value: refY.label, fill: refY.color, fontSize: 11, position: "insideTopRight" }} />}
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "5 4" : undefined} dot={s.dot ? { r: 3, strokeWidth: 0, fill: s.color } : false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
        ))}
      </LineChart>
    </ChartFrame>
  );
}

export function Bars({ data, xKey, series, label, height, yFmt, yDomain, summary, stacked, layout = "horizontal" }: {
  data: Record<string, unknown>[];
  xKey: string;
  series: SeriesDef[];
  label: string;
  height?: number;
  yFmt?: (v: number) => string;
  yDomain?: [number, number];
  summary?: string;
  stacked?: boolean;
  layout?: "horizontal" | "vertical";
}) {
  const tt = useTooltipStyle();
  const c = useChartColors();
  const vertical = layout === "vertical";
  return (
    <ChartFrame label={label} height={height} summary={summary}>
      <BarChart data={data} layout={layout} margin={{ top: 8, right: 16, bottom: 4, left: vertical ? 8 : 0 }} barGap={3}>
        <CartesianGrid strokeDasharray="3 3" vertical={vertical} horizontal={!vertical} />
        {vertical ? (
          <>
            <XAxis type="number" domain={yDomain ?? [0, "auto"]} tickFormatter={yFmt} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey={xKey} tickLine={false} axisLine={{ stroke: c.line }} width={110} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: c.line }} interval={0} tick={{ fontSize: 11 }} />
            <YAxis domain={yDomain ?? [0, "auto"]} tickFormatter={yFmt} tickLine={false} axisLine={false} width={48} />
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
  return (
    <ChartFrame label={label} height={height} summary={`${label}. ${curves.map((x) => x.name).join(", ")}. Diagonal line is random guessing.`}>
      <LineChart margin={{ top: 8, right: 16, bottom: 18, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" dataKey="fpr" domain={[0, 1]} tickFormatter={(v) => v.toFixed(1)} tickLine={false} axisLine={{ stroke: c.line }} label={{ value: "False positive rate", position: "insideBottom", offset: -10, fill: c.muted, fontSize: 11 }} allowDuplicatedCategory={false} />
        <YAxis type="number" domain={[0, 1]} tickFormatter={(v) => v.toFixed(1)} tickLine={false} axisLine={false} width={58} label={{ value: "True positive rate", angle: -90, position: "insideLeft", fill: c.muted, fontSize: 11, dx: 4, dy: 50 }} />
        <Tooltip {...tt} formatter={(v: number) => v.toFixed(3)} labelFormatter={(v) => `FPR ${Number(v).toFixed(3)}`} />
        <Legend iconType="plainline" wrapperStyle={{ paddingTop: 12 }} />
        <Line data={[{ fpr: 0, tpr: 0 }, { fpr: 1, tpr: 1 }]} dataKey="tpr" name="Random guess" stroke={c.muted} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
        {curves.map((cv) => (
          <Line key={cv.name} data={cv.points} dataKey="tpr" name={cv.name} stroke={cv.color} strokeWidth={2} dot={false} type="stepAfter" isAnimationActive={false} />
        ))}
      </LineChart>
    </ChartFrame>
  );
}

export function PrivacyUtility({ points, baseline, label, height = 300, connect = true }: { points: { epsilon: number; accuracy: number; name: string }[]; baseline?: number; label: string; height?: number; connect?: boolean }) {
  const tt = useTooltipStyle();
  const c = useChartColors();
  const sorted = [...points].sort((a, b) => a.epsilon - b.epsilon);
  const lo = sorted[0]?.epsilon ?? 0.1;
  const hi = sorted[sorted.length - 1]?.epsilon ?? 10;
  const ticks = [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64].filter((t) => t >= lo / 1.5 && t <= hi * 1.5);
  return (
    <ChartFrame label={label} height={height} summary={`${label}: ${points.map((p) => `ε ${p.epsilon.toFixed(2)} → accuracy ${(p.accuracy * 100).toFixed(1)}%`).join("; ")}`}>
      <ScatterChart margin={{ top: 8, right: 20, bottom: 18, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" dataKey="epsilon" name="ε" scale="log" domain={[Math.min(lo, ticks[0] ?? lo) * 0.9, Math.max(hi, ticks[ticks.length - 1] ?? hi) * 1.1]} ticks={ticks} tickFormatter={(v) => String(Number(v))} tickLine={false} axisLine={{ stroke: c.line }} label={{ value: "Privacy budget ε (log scale, lower = more private)", position: "insideBottom", offset: -10, fill: c.muted, fontSize: 11 }} />
        <YAxis type="number" dataKey="accuracy" name="Accuracy" domain={["auto", "auto"]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} tickLine={false} axisLine={false} width={44} />
        <ZAxis range={[70, 70]} />
        <Tooltip {...tt} formatter={(v: number, n: string) => (n === "Accuracy" ? `${(v * 100).toFixed(2)}%` : v.toFixed(3))} />
        {baseline != null && <ReferenceLine y={baseline} stroke={c.blue} strokeDasharray="4 4" label={{ value: "Non-private", fill: c.blue, fontSize: 11, position: "insideBottomRight" }} />}
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
