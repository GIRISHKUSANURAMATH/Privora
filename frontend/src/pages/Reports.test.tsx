import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui";
import { ThemeProvider } from "../lib/theme";
import Reports from "./Reports";

/*
 * Regression (screenshots 09 and 15): the screenshot run clicked "Generate report" although
 * run_experiments.py had already written one, so every capture added a duplicate report and a
 * success toast. Saved reports can now be previewed, which only reads the stored file.
 */
const saved = { id: "r1", experiment_id: "e1", title: "Experiment A report", created_at: new Date().toISOString(), experiment_type: "dp", experiment_exists: true };

function setup(download: () => Response) {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      if (url === "/api/reports") return new Response(JSON.stringify([saved]), { status: 200 });
      if (url.startsWith("/api/experiments")) return new Response(JSON.stringify([{ id: "e1", name: "Experiment A", type: "dp", status: "completed", progress: 1 }]), { status: 200 });
      if (url === "/api/reports/r1/download?format=md") return download();
      return new Response("{}", { status: 200 });
    }),
  );
  render(
    <ThemeProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <MemoryRouter>
            <Reports />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return calls;
}

describe("Reports preview", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows a saved report without generating a new one", async () => {
    const calls = setup(() => new Response("# Experiment A report\n\nPrivacy accounting ...", { status: 200, headers: { "Content-Type": "text/markdown" } }));
    fireEvent.click(await screen.findByRole("button", { name: "Preview report Experiment A report" }));
    expect(await screen.findByLabelText("Report preview")).toHaveTextContent("Privacy accounting");
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    expect(calls.some((c) => c.url === "/api/reports/r1/download?format=md")).toBe(true);
  });

  it("surfaces a failed preview as an error instead of hiding it", async () => {
    setup(() => new Response(JSON.stringify({ detail: "Report file missing" }), { status: 404 }));
    fireEvent.click(await screen.findByRole("button", { name: "Preview report Experiment A report" }));
    expect(await screen.findByText("Couldn't open the report")).toBeInTheDocument();
    expect(await screen.findByText("Report file missing")).toBeInTheDocument();
  });
});
