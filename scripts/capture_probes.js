// Browser-side checks used by capture_screenshots.py (each is an arrow function run with page.evaluate).
// They return human-readable problems; backend/tests/test_capture_checks.py runs each against a page
// with the defect and one without.

// @probe layout
() => {
  const issues = [];
  const box = (el) => el.getBoundingClientRect();
  const visible = (el) => { const r = box(el); return r.width > 0 && r.height > 0; };
  const desc = (el) => {
    const cls = typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 4).join(".") : "";
    const txt = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `<${el.tagName.toLowerCase()}${cls ? "." + cls : ""}>${txt ? ' "' + txt + '"' : ""}`;
  };
  const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
                         Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

  // 1. Elements wider than a non-clipping parent (the Overview cards at 390 px).
  const root = document.querySelector("#main") || document.body;
  for (const el of root.querySelectorAll("*")) {
    if (el.closest("svg, .recharts-wrapper, .sr-only")) continue;
    const cs = getComputedStyle(el);
    if (["absolute", "fixed"].includes(cs.position) || ["inline", "contents", "none"].includes(cs.display)) continue;
    const p = el.parentElement;
    if (!p || getComputedStyle(p).overflowX !== "visible" || !visible(el) || !visible(p)) continue;
    const r = box(el), pr = box(p);
    const over = Math.max(r.right - pr.right, pr.left - r.left);
    if (over > 1.5) issues.push(`element sticks out of its container by ${Math.round(over)}px: ${desc(el)} in ${desc(p)}`);
  }

  for (const [ci, w] of [...document.querySelectorAll(".recharts-wrapper")].entries()) {
    if (!visible(w)) continue;
    const name = `chart ${ci + 1} (${(w.closest("figure")?.getAttribute("aria-label") || "").slice(0, 50)})`;
    // 2. Text that touches other text, or that a data point covers.
    const texts = [...w.querySelectorAll("svg text, .recharts-legend-item")]
      .filter((t) => visible(t) && (t.textContent || "").trim())
      .map((t) => ({ s: t.textContent.trim().slice(0, 30), r: box(t) }));
    for (let i = 0; i < texts.length; i++)
      for (let j = i + 1; j < texts.length; j++)
        if (area(texts[i].r, texts[j].r) > 4) issues.push(`${name}: labels overlap: "${texts[i].s}" / "${texts[j].s}"`);
    // Text cut off at the edge of the chart (an axis label wider than its axis).
    const svgBox = w.querySelector("svg.recharts-surface") ? box(w.querySelector("svg.recharts-surface")) : box(w);
    for (const t of w.querySelectorAll("svg text")) {
      if (!visible(t) || !(t.textContent || "").trim()) continue;
      const r = box(t);
      if (r.left < svgBox.left - 1 || r.right > svgBox.right + 1 || r.top < svgBox.top - 1 || r.bottom > svgBox.bottom + 1)
        issues.push(`${name}: label "${t.textContent.trim().slice(0, 30)}" is cut off at the chart edge`);
    }
    const points = [...w.querySelectorAll(".recharts-scatter-symbol, .recharts-dot")].filter(visible).map(box);
    for (const t of texts) if (points.some((p) => area(p, t.r) > 4)) issues.push(`${name}: a data point covers the label "${t.s}"`);

    // 3. Numeric axis labels must sit where they say (linear axis, or a log axis).
    for (const ax of w.querySelectorAll(".recharts-cartesian-axis")) {
      const horizontal = ax.classList.contains("recharts-xAxis");
      const ticks = [...ax.querySelectorAll(".recharts-cartesian-axis-tick")].map((g) => {
        const t = g.querySelector("text");
        const label = (t?.textContent || "").trim().replace(/\u2212/g, "-");
        const r = t ? box(t) : null;
        return { label, pos: r ? (horizontal ? r.left + r.width / 2 : r.top + r.height / 2) : NaN };
      });
      if (ticks.length < 3 || !ticks.every((t) => /^-?\d+(\.\d+)?%?$/.test(t.label))) continue;
      const vals = ticks.map((t) => Number(t.label.replace("%", "")) / (t.label.endsWith("%") ? 100 : 1));
      const fits = (f) => {
        const a = f(vals[0]), b = f(vals[vals.length - 1]);
        if (a === b) return false;
        const k = (ticks[ticks.length - 1].pos - ticks[0].pos) / (b - a);
        return vals.every((v, i) => Math.abs(ticks[0].pos + k * (f(v) - a) - ticks[i].pos) <= 2.5);
      };
      if (!fits((v) => v) && !(vals.every((v) => v > 0) && fits(Math.log10)))
        issues.push(`${name}: ${horizontal ? "x" : "y"}-axis labels do not match their positions: ${ticks.map((t) => t.label).join(", ")}`);
    }
  }
  return issues;
}
// @end

// @probe sidebar
() => {
  const aside = document.querySelector("aside");
  if (!aside || getComputedStyle(aside).display === "none") return { checked: false, issues: [] };
  const issues = [];
  const nav = aside.querySelector("nav");
  const btn = aside.lastElementChild.querySelector("button");
  const fr = btn.getBoundingClientRect();
  if (fr.top < 0 || fr.bottom > innerHeight) issues.push("sidebar Collapse control is not fully visible");
  const fits = nav.scrollHeight <= nav.clientHeight + 1;
  if (innerHeight >= 720 && !fits) issues.push(`sidebar menu needs scrolling at ${innerHeight}px (${nav.scrollHeight}px > ${nav.clientHeight}px)`);
  if (!fits && getComputedStyle(nav).overflowY !== "auto" && getComputedStyle(nav).overflowY !== "scroll")
    issues.push("sidebar menu overflows but does not scroll");
  for (const a of nav.querySelectorAll("a")) {
    a.scrollIntoView({ block: "nearest", behavior: "instant" });
    const r = a.getBoundingClientRect(), n = nav.getBoundingClientRect();
    const label = (a.textContent || "").trim();
    if (r.top < n.top - 0.5 || r.bottom > n.bottom + 0.5) issues.push(`sidebar item "${label}" cannot be scrolled fully into view`);
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!a.contains(hit)) issues.push(`sidebar item "${label}" is covered by another element`);
  }
  nav.scrollTop = 0;
  return { checked: true, issues };
}
// @end

// @probe overflow
// The element furthest past the right edge of the viewport that no ancestor clips (for messages).
() => {
  const out = [...document.querySelectorAll('body *')].filter((e) => {
    const r = e.getBoundingClientRect();
    if (r.right <= innerWidth + 1) return false;
    for (let p = e.parentElement; p; p = p.parentElement)
      if (getComputedStyle(p).overflowX !== 'visible') return false;
    return true;
  }).sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];
  if (!out) return '';
  const cls = typeof out.className === 'string' ? out.className.slice(0, 80) : '';
  return `${out.tagName.toLowerCase()}.${cls} right=${Math.round(out.getBoundingClientRect().right)}px`;
}
// @end
