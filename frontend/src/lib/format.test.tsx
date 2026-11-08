import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, Confirm, Segmented } from "../components/ui";
import { ApiError, api } from "./api";
import { epsBand, eps, pct } from "./format";

describe("format helpers", () => {
  it("formats percentages and epsilon", () => {
    expect(pct(0.8734)).toBe("87.3%");
    expect(pct(null)).toBe("—");
    expect(eps(null)).toBe("∞");
    expect(eps(2.345)).toBe("2.35");
    expect(eps(12.34)).toBe("12.3");
  });

  it("bands epsilon values without inventing a guarantee", () => {
    expect(epsBand(null).label).toBe("No formal guarantee");
    expect(epsBand(0.5).label).toBe("Strong");
    expect(epsBand(8).tone).toBe("amber");
    expect(epsBand(30).label).toBe("Very weak");
  });
});

describe("api client", () => {
  it("surfaces backend error details", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Dataset not found" }), { status: 404 })));
    await expect(api.dataset("x")).rejects.toMatchObject({ status: 404, message: "Dataset not found" });
    vi.unstubAllGlobals();
  });

  it("reports an unreachable backend clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const err = await api.datasets().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toMatch(/backend/);
    vi.unstubAllGlobals();
  });
});

describe("ui components", () => {
  it("segmented control exposes radio semantics", async () => {
    const onChange = vi.fn();
    render(<Segmented ariaLabel="Mode" value="a" onChange={onChange} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />);
    expect(screen.getByRole("radio", { name: "A" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("radio", { name: "B" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("confirm dialog calls onConfirm and closes", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<Confirm open title="Delete?" body="Really" confirmLabel="Delete it" onConfirm={onConfirm} onClose={onClose} danger />);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete it" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalled();
  });

  it("button shows loading state and is disabled", () => {
    render(<Button loading>Run</Button>);
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });
});
