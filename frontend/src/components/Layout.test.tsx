import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
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
