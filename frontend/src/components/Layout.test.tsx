import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../lib/theme";
import { Layout } from "./Layout";
import { ToastProvider } from "./ui";

/*
 * Regression: Layout's scroll-to-top effect was written as `useEffect(() => window.scrollTo(0, 0))`.
 * Current Chromium returns a Promise from scrollTo, so the effect returned a Promise and React
 * crashed with "destroy is not a function" on the next route change (seen after
 * "Create a demo dataset" navigated from Overview to Dataset Studio).
 */
describe("Layout navigation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("survives navigation when window.scrollTo returns a Promise", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation((() => Promise.resolve()) as unknown as typeof window.scrollTo);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    const router = createMemoryRouter(
      [{ element: <Layout />, children: [{ path: "/", element: <p>home page</p> }, { path: "/datasets", element: <p>datasets page</p> }] }],
      { initialEntries: ["/"] },
    );
    render(
      <ThemeProvider>
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </QueryClientProvider>
      </ThemeProvider>,
    );
    expect(await screen.findByText("home page")).toBeInTheDocument();
    await act(async () => {
      await router.navigate("/datasets");
    });
    expect(await screen.findByText("datasets page")).toBeInTheDocument();
    await act(async () => {
      await router.navigate("/");
    });
    expect(await screen.findByText("home page")).toBeInTheDocument();
    expect(window.scrollTo).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("effects never return a value implicitly", () => {
  it("has no expression-bodied useEffect / useLayoutEffect anywhere in src", () => {
    const files = import.meta.glob("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const offenders = Object.entries(files)
      .filter(([path]) => !path.endsWith(".test.tsx"))
      .flatMap(([path, src]) => (src.match(/use(Layout)?Effect\(\(\)\s*=>\s*[^{\s]/g) ?? []).map((m) => `${path}: ${m}`));
    expect(Object.keys(files).length).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });
});

/*
 * Regression (screenshot 18): at 1280 x 720 the desktop sidebar needed ~747 px, so "Documentation"
 * sat half under the Collapse bar. The menu must scroll on its own, the brand and footer must not
 * shrink, and at 720 px every item must fit without scrolling. Heights are derived from the
 * rendered Tailwind classes, so restoring the old h-9 / mt-5 spacing fails this test.
 */
describe("desktop sidebar height", () => {
  const px = (cls: string, prefix: string): number => {
    const m = new RegExp(`(?:^|\\s)${prefix}-(\\d+(?:\\.\\d+)?)(?:\\s|$)`).exec(cls);
    return m ? Number(m[1]) * 4 : 0;
  };
  it("fits every navigation item above the footer at 720 px and scrolls independently below that", async () => {
    cleanup();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    const router = createMemoryRouter([{ element: <Layout />, children: [{ path: "/", element: <p>home page</p> }] }], { initialEntries: ["/"] });
    render(
      <ThemeProvider>
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </QueryClientProvider>
      </ThemeProvider>,
    );
    await screen.findByText("home page");
    const aside = document.querySelector("aside")!;
    const [brand, nav, footer] = [...aside.children] as HTMLElement[];
    expect(nav.tagName).toBe("NAV");
    for (const c of ["min-h-0", "flex-1", "overflow-y-auto"]) expect(nav.classList).toContain(c);
    expect(brand.classList).toContain("shrink-0");
    expect(footer.classList).toContain("shrink-0");

    const groups = [...nav.children] as HTMLElement[];
    let navH = px(nav.className, "pb");
    groups.forEach((g, i) => {
      navH += i === 0 ? px(g.className.replace(/(^|\s)mt-\S+/, ""), "first:mt") : px(g.className, "mt");
      const label = g.querySelector("p");
      if (label) navH += 16 + px(label.className, "pb");
      const items = [...g.querySelectorAll("li a")] as HTMLElement[];
      const gap = px(g.querySelector("ul")!.className, "space-y");
      navH += items.reduce((a, el) => a + px(el.className, "h"), 0) + gap * (items.length - 1);
    });
    const footerH = 2 * px(footer.className, "p") + 1 + px(footer.querySelector("button")!.className, "h");
    const total = px(brand.className, "h") + navH + footerH;
    expect(groups.length).toBeGreaterThanOrEqual(5);
    expect(total).toBeGreaterThan(500);
    expect(total).toBeLessThanOrEqual(720);
    vi.unstubAllGlobals();
  });
});
