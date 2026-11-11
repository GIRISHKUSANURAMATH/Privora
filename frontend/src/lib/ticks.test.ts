import { describe, expect, it } from "vitest";
import { exactTicks, labelIsExact, niceStep, ROC_TICKS, rocTickLabel, shortenAtWord, wrapLabel } from "./ticks";
import { categoryLayout } from "../components/charts";

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const pctRound = (v: number) => `${Math.round(v * 100)}%`;

describe("niceStep", () => {
  it("returns 1, 2 or 5 x 10^k", () => {
    expect(niceStep(0.013)).toBe(0.02);
    expect(niceStep(0.03)).toBe(0.05);
    expect(niceStep(0.07)).toBe(0.1);
    expect(niceStep(2.4)).toBe(5);
    expect(niceStep(1)).toBe(1);
  });
});

describe("exactTicks", () => {
  it("never prints a rounded label: the 0.6-0.74 accuracy axis gets whole-percent ticks", () => {
    const t = exactTicks(0.6, 0.74, pct);
    expect(t[0]).toBeLessThanOrEqual(0.6);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(0.74);
    for (const v of t) expect(labelIsExact(v, pct(v))).toBe(true);
    expect(t.length).toBeLessThanOrEqual(6);
  });

  it("detects the original bug: Recharts-style 0.635 printed as 64% is not exact", () => {
    expect(labelIsExact(0.635, pct(0.635))).toBe(false);
    expect(labelIsExact(0.25, (0.25).toFixed(1))).toBe(false);
  });

  it("handles fixed [0, 1] percent domains and toFixed(2) formatters", () => {
    expect(exactTicks(0, 1, pctRound)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    for (const v of exactTicks(0.111, 0.912, (x) => x.toFixed(2))) expect(labelIsExact(v, v.toFixed(2))).toBe(true);
  });

  it("handles formatters that print the value itself as a percentage (Missing %: 2.74 -> 2.74%)", () => {
    // Regression: "${v}%" was treated like a fraction formatter, so no step was ever exact and the
    // Data quality axis became 0% .. 100000000% with invisible bars.
    const fmt = (v: number) => `${v}%`;
    const t = exactTicks(0, 2.74, fmt);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(2.74);
    expect(t[t.length - 1]).toBeLessThanOrEqual(5);
    expect(t.length).toBeGreaterThanOrEqual(3);
  });

  it("never runs away: the top tick stays within a few steps of the data", () => {
    for (const [lo, hi, fmt] of [[0, 2.74, (v: number) => `${v}%`], [0.6, 0.74, pct], [0, 913, String], [0.0001, 0.0009, (v: number) => v.toFixed(4)]] as const) {
      const t = exactTicks(lo, hi, fmt);
      expect(t[t.length - 1] - hi).toBeLessThanOrEqual((hi - lo) * 1.01);
      expect(lo - t[0]).toBeLessThanOrEqual((hi - lo) * 1.01);
    }
  });

  it("covers flat and reversed ranges", () => {
    const flat = exactTicks(0.5, 0.5);
    expect(flat[0]).toBeLessThan(0.5);
    expect(flat[flat.length - 1]).toBeGreaterThan(0.5);
    expect(exactTicks(10, 0)[0]).toBe(0);
  });
});

describe("ROC ticks", () => {
  it("are 0, 0.2, ..., 1 and print exactly", () => {
    expect([...ROC_TICKS]).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    for (const v of ROC_TICKS) expect(labelIsExact(v, rocTickLabel(v))).toBe(true);
  });
});

describe("label shortening", () => {
  const name = "Experiment A · Conventional vs DP (ε=3) on census income";
  it("cuts at a word boundary and marks the cut", () => {
    const s = shortenAtWord(name, 28);
    expect(s.endsWith("…")).toBe(true);
    const head = s.slice(0, -1);
    expect(name.startsWith(head)).toBe(true);
    expect(name[head.length]).toBe(" ");
    // The old `slice(0, 20)`-style cut ends mid-word here ("Conventional" -> "Conven").
    expect(name.slice(0, 21).endsWith("Conven")).toBe(true);
    expect(shortenAtWord(name, 21)).toBe("Experiment A…");
  });
  it("leaves short text alone", () => expect(shortenAtWord("Loss threshold", 28)).toBe("Loss threshold"));
});

describe("category label layout", () => {
  it("wraps whole words at phone width (Entropy threshold / Shadow models at 390 px)", () => {
    const labels = ["Loss threshold", "Confidence threshold", "Entropy threshold", "Shadow models", "Label-only attack"];
    const band = (390 - 48 - 16) / labels.length;
    const { fontPx, lines } = categoryLayout(labels, band);
    expect(fontPx).toBeGreaterThanOrEqual(9);
    lines.forEach((ls, i) => {
      expect(ls.join(" ")).toBe(labels[i]);
      for (const l of ls) expect(l.length * fontPx * 0.58).toBeLessThanOrEqual(band - 8);
    });
  });
  it("keeps the 11 px font and one line when there is room", () => {
    const { fontPx, lines } = categoryLayout(["Loss", "Shadow models"], 400);
    expect(fontPx).toBe(11);
    expect(lines.every((l) => l.length === 1)).toBe(true);
  });
  it("wrapLabel limits lines and never splits short words", () => {
    expect(wrapLabel("a b c d e f g h i j k l m n o p", 40, 6.4, 2).length).toBe(2);
    expect(wrapLabel("Shadow models", 200)).toEqual(["Shadow models"]);
  });
});

describe("histogram bin labels", () => {
  it("prints 1.5-wide bins with their decimal (the 15, 16, 18 ... labels at 15, 16.5, 18)", async () => {
    const { histogramRows } = await import("../pages/DatasetStudio");
    const edges = Array.from({ length: 21 }, (_, i) => 15 + i * 1.5);
    const rows = histogramRows({ edges, counts: new Array(20).fill(1) });
    rows.forEach((r, i) => expect(Math.abs(Number(r.bin) - edges[i])).toBeLessThanOrEqual(0.03));
    expect(rows[1].bin).toBe("16.5");
    expect(histogramRows({ edges: [0, 10, 20], counts: [1, 2] }).map((r) => r.bin)).toEqual(["0", "10"]);
    expect(histogramRows({ edges: [0, 12.5, 25], counts: [1, 2] }).map((r) => r.bin)).toEqual(["0.0", "12.5"]);
  });
});

describe("exactTicks fallback", () => {
  it("keeps a sane axis when the formatter is too coarse to be exact", () => {
    const t = exactTicks(0, 0.004, pct); // whole percent on a 0.4 % range
    expect(t[t.length - 1]).toBeLessThanOrEqual(0.01);
    expect(t.length).toBeGreaterThanOrEqual(2);
  });
});
