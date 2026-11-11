import { describe, expect, it } from "vitest";

/*
 * Regressions found at 390 px phone width (post-publication audit):
 *  1. Attack Lab: page grids had no explicit column below `xl`, so their implicit `auto` track grew
 *     to the widest native <select> option and the whole page scrolled sideways (411 px).
 *  2. Federated Studio: screen-reader labels (`sr-only`, absolutely positioned) inside the
 *     participation table escaped its horizontal scroll box, whose wrapper was not positioned,
 *     and widened the page to 520 px.
 * These source guards keep both fixes in place for every page and scroll container.
 */
const files = import.meta.glob("./**/*.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const sources = Object.entries(files).filter(([path]) => !path.endsWith(".test.tsx"));
const classNames = (src: string) => [...src.matchAll(/className="([^"]*)"/g)].map((m) => m[1]);

describe("responsive layout guards", () => {
  it("scans the UI sources", () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  // 3. Overview (screenshot 15): the Start-something grid had only sm:/lg: columns, so at 390 px its
  //    cards grew 7 px past the panel. The guard now covers every breakpoint, not just xl/2xl.
  it("gives every responsive page grid (sm/md/lg/xl/2xl) an explicit shrinkable column below the breakpoint", () => {
    const offenders = sources.flatMap(([path, src]) =>
      classNames(src)
        .filter((c) => /(^|\s)grid(\s|$)/.test(c) && /(^|\s)(sm|md|lg|2?xl):grid-cols-/.test(c) && !/(^|\s)grid-cols-/.test(c))
        .map((c) => `${path}: "${c}"`),
    );
    expect(offenders).toEqual([]);
  });

  it("still detects the original Overview grid if its base column were removed", () => {
    const bad = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3";
    expect(/(^|\s)(sm|md|lg|2?xl):grid-cols-/.test(bad) && !/(^|\s)grid-cols-/.test(bad)).toBe(true);
    const overview = sources.find(([p]) => p.endsWith("pages/Overview.tsx"))?.[1] ?? "";
    expect(overview).toContain("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3");
  });

  it("positions every horizontal scroll container so absolutely positioned content stays inside it", () => {
    const offenders = sources.flatMap(([path, src]) =>
      classNames(src)
        .filter((c) => /(^|\s)overflow-(x-)?auto(\s|$)/.test(c) && !/(^|\s)relative(\s|$)/.test(c))
        .map((c) => `${path}: "${c}"`),
    );
    expect(offenders).toEqual([]);
  });
});
