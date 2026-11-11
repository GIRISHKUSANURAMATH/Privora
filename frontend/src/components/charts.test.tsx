import { render } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ThemeProvider } from "../lib/theme";
import { Bars, Lines, PrivacyUtility, ROC } from "./charts";

/*
 * Rendered-SVG regressions for the screenshot inspection:
 *  - ROC (screenshots 07, 16): Recharts placed ticks at 0, 0.25, 0.5, 0.75, 1 and toFixed(1) printed
 *    them as 0.0, 0.3, 0.5, 0.8, 1.0, so labels did not match their positions.
 *  - Percent axes printed rounded labels (63%) at non-round positions (63.5 %).
 *  - Long category labels (Attack Lab "Entropy threshold" / "Shadow models", screenshot 16; Analytics
 *    federated run names, screenshot 08) were drawn on one line and ran into each other.
 *  - The "Non-private" reference label sat inside the plot where scatter points covered it.
 * Each test reads the labels and pixel positions Recharts actually renders.
 */
const W = 390;
const H = 300;
let restore: (() => void)[] = [];
class FixedResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe() {
    this.cb([{ contentRect: { width: W, height: H } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}
beforeAll(() => {
  const hadRO = "ResizeObserver" in globalThis;
  const origRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FixedResizeObserver;
  restore.push(() => {
    if (hadRO) (globalThis as { ResizeObserver?: unknown }).ResizeObserver = origRO;
    else delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  });
  // Only the chart container is sized (through ResizeObserver); legends keep jsdom's zero size.
  for (const [prop, value] of [["clientWidth", W], ["clientHeight", H]] as const) {
    const orig = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
    restore.push(() => orig && Object.defineProperty(HTMLElement.prototype, prop, orig));
  }
});
afterAll(() => {
  restore.forEach((r) => r());
  restore = [];
});

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

type Tick = { label: string; x: number; y: number };
function axisTicks(container: HTMLElement, axis: "x" | "y"): Tick[] {
  const sel = axis === "x" ? ".recharts-xAxis .recharts-cartesian-axis-tick" : ".recharts-yAxis .recharts-cartesian-axis-tick";
  return [...container.querySelectorAll(sel)].map((g) => {
    const t = g.querySelector("text")!;
    return { label: (t.textContent ?? "").trim(), x: Number(t.getAttribute("x")), y: Number(t.getAttribute("y")) };
  });
}

/** Parsed label values must map to pixel positions by one linear function (labels sit where they say). */
function expectLinear(ticks: Tick[], coord: "x" | "y", parse = (l: string) => Number(l.replace("%", "")) / (l.includes("%") ? 100 : 1)) {
  expect(ticks.length).toBeGreaterThanOrEqual(3);
  const pts = ticks.map((t) => [parse(t.label), t[coord]] as const);
  const [v0, p0] = pts[0];
  const [v1, p1] = pts[pts.length - 1];
  const slope = (p1 - p0) / (v1 - v0);
  for (const [v, p] of pts) expect(Math.abs(p0 + slope * (v - v0) - p)).toBeLessThan(0.5);
}

describe("ROC axes", () => {
  it("labels 0, 0.2, ..., 1.0 at their true positions on both axes", () => {
    const { container } = wrap(<ROC label="ROC" curves={[{ name: "Loss threshold", color: "#f00", points: [{ fpr: 0, tpr: 0 }, { fpr: 0.3, tpr: 0.6 }, { fpr: 1, tpr: 1 }] }]} />);
    for (const axis of ["x", "y"] as const) {
      const ticks = axisTicks(container, axis);
      expect(ticks.map((t) => t.label)).toEqual(["0.0", "0.2", "0.4", "0.6", "0.8", "1.0"]);
      expectLinear(ticks, axis);
    }
  });
});

describe("data-driven value axes", () => {
  it("prints exact percent labels for a narrow accuracy range (the 63% at 63.5% bug)", () => {
    const pts = [0.6, 0.65, 0.7, 0.74].map((a, i) => ({ epsilon: [0.5, 1, 3, 8][i], accuracy: a, name: `m${i}` }));
    const { container } = wrap(<PrivacyUtility label="pu" points={pts} baseline={0.74} />);
    const ticks = axisTicks(container, "y");
    for (const t of ticks) expect(t.label).toMatch(/^\d+%$/);
    expectLinear(ticks, "y");
    // Every label must be a multiple of the step, i.e. a value that genuinely sits on a gridline.
    const vals = ticks.map((t) => Number(t.label.replace("%", "")));
    const step = vals[1] - vals[0];
    expect([1, 2, 5, 10, 20, 25, 50]).toContain(step);
  });

  it("keeps line-chart labels exact for toFixed(2) formatters", () => {
    const data = [0.111, 0.42, 0.637, 0.912].map((v, i) => ({ x: i, v }));
    const { container } = wrap(<Lines label="l" data={data} xKey="x" series={[{ key: "v", name: "v", color: "#00f" }]} yFmt={(v) => v.toFixed(2)} />);
    const ticks = axisTicks(container, "y");
    expectLinear(ticks, "y");
  });
});

describe("reference labels", () => {
  it("explains the Non-private baseline below the plot instead of inside it", () => {
    const { container } = wrap(<PrivacyUtility label="pu" points={[{ epsilon: 1, accuracy: 0.7, name: "a" }, { epsilon: 4, accuracy: 0.8, name: "b" }]} baseline={0.82} />);
    const svgText = [...container.querySelectorAll("svg text")].map((t) => t.textContent).join(" ");
    expect(svgText).not.toMatch(/Non-private/);
    expect(container.querySelector("figure")!.textContent).toMatch(/Non-private/);
  });
});

describe("category labels", () => {
  it("wraps long labels so neighbouring ticks never overlap at 390 px", () => {
    const data = [
      { m: "Loss threshold", auc: 0.6 },
      { m: "Confidence threshold", auc: 0.62 },
      { m: "Entropy threshold", auc: 0.58 },
      { m: "Shadow models", auc: 0.65 },
      { m: "Label-only attack", auc: 0.55 },
    ];
    const { container } = wrap(<Bars label="b" data={data} xKey="m" series={[{ key: "auc", name: "AUC", color: "#f0f" }]} yDomain={[0, 1]} yFmt={(v) => v.toFixed(2)} />);
    const ticks = [...container.querySelectorAll(".recharts-xAxis .recharts-cartesian-axis-tick")];
    expect(ticks.length).toBe(data.length);
    const spans = ticks.map((g) => {
      const charPx = Number(g.querySelector("text")?.getAttribute("font-size")) * 0.58;
      const tr = g.querySelector("g")?.getAttribute("transform") ?? "";
      const cx = Number(/translate\(([-\d.]+)/.exec(tr)?.[1]);
      const lines = [...g.querySelectorAll("tspan")].map((s) => s.textContent ?? "");
      expect(lines.join(" ").replace("…", "")).not.toBe("");
      const half = (Math.max(...lines.map((l) => l.length)) * charPx) / 2;
      return [cx - half, cx + half] as const;
    });
    for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBeGreaterThan(spans[i - 1][1]);
    // Whole words only: no tick line ends mid-word.
    const words = new Set(data.flatMap((d) => d.m.split(" ")));
    for (const g of ticks) for (const s of g.querySelectorAll("tspan")) for (const w of (s.textContent ?? "").split(" ")) expect(words.has(w)).toBe(true);
  });
});

describe("chart frame", () => {
  it("clips horizontally, so a hidden tooltip positioned past the edge cannot widen the page", () => {
    // Regression: Analytics at 390 px intermittently scrolled sideways to 439 px because a
    // Recharts tooltip wrapper sat beyond the viewport before any hover.
    const { container } = wrap(<Lines label="l" data={[{ x: 0, v: 1 }, { x: 1, v: 2 }]} xKey="x" series={[{ key: "v", name: "v", color: "#00f" }]} />);
    expect(container.querySelector("figure")!.className).toMatch(/(^|\s)overflow-x-clip(\s|$)/);
  });
});
