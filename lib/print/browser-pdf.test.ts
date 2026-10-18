import { describe, expect, it, vi } from "vitest";
import { printPdfBlob, type PrintHost } from "@/lib/print/browser-pdf";

describe("printPdfBlob", () => {
  it("creates a hidden iframe and calls print", () => {
    const print = vi.fn();
    const focus = vi.fn();
    const style: Record<string, string> = {};
    const frame = {
      setAttribute: vi.fn(),
      style,
      contentWindow: { focus, print },
      src: "",
      onload: null as null | (() => void),
      remove: vi.fn(),
    };
    const host: PrintHost = {
      createElement: () => frame as unknown as HTMLIFrameElement,
      body: { appendChild: vi.fn((node) => node) },
    };
    const { href } = printPdfBlob(new Blob(["%PDF-1.4"], { type: "application/pdf" }), host);
    expect(href.startsWith("blob:")).toBe(true);
    expect(frame.setAttribute).toHaveBeenCalledWith("aria-hidden", "true");
    expect(host.body.appendChild).toHaveBeenCalled();
    expect(frame.src).toBe(href);
    frame.onload?.();
    expect(focus).toHaveBeenCalled();
    expect(print).toHaveBeenCalled();
  });
});
