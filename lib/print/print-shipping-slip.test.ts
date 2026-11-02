import { describe, expect, it, vi } from "vitest";
import { runPrintShippingSlip } from "@/lib/print/print-shipping-slip";

describe("runPrintShippingSlip", () => {
  it("queues custom-print when the Print Agent is connected", async () => {
    const fetchSlipPdf = vi.fn();
    const printPdf = vi.fn();
    const queueAgentPrint = vi.fn(async () => ({
      message: "Queued for the Print Agent.",
      job: { printerName: "HP LaserJet" },
    }));
    const result = await runPrintShippingSlip({
      connected: true,
      shipmentId: "ship-1",
      labelId: "lab-1",
      queueName: "HP LaserJet",
      fetchSlipPdf,
      printPdf,
      queueAgentPrint,
    });
    expect(queueAgentPrint).toHaveBeenCalledWith("ship-1");
    expect(fetchSlipPdf).not.toHaveBeenCalled();
    expect(printPdf).not.toHaveBeenCalled();
    expect(result).toEqual({ mode: "agent", message: "Queued for HP LaserJet" });
  });

  it("prints the shipping-slip PDF when custom-print reports the agent is offline", async () => {
    const blob = new Blob(["pdf"]);
    const fetchSlipPdf = vi.fn(async () => blob);
    const printPdf = vi.fn();
    const queueAgentPrint = vi.fn(async () => ({
      connected: false,
      downloadPath: "/api/v1/labels/lab-1/download",
      message: "Print Agent offline.",
    }));
    const result = await runPrintShippingSlip({
      connected: true,
      shipmentId: "ship-1",
      labelId: "lab-1",
      fetchSlipPdf,
      printPdf,
      queueAgentPrint,
    });
    expect(queueAgentPrint).toHaveBeenCalledWith("ship-1");
    expect(fetchSlipPdf).toHaveBeenCalledWith("lab-1");
    expect(printPdf).toHaveBeenCalledWith(blob);
    expect(result).toEqual({ mode: "browser", message: "Opened the browser print dialog" });
  });

  it("prints the shipping-slip PDF in the browser when the agent is offline", async () => {
    const blob = new Blob(["pdf"]);
    const fetchSlipPdf = vi.fn(async (labelId: string) => {
      expect(labelId).toBe("lab-1");
      return blob;
    });
    const printPdf = vi.fn();
    const queueAgentPrint = vi.fn();
    const result = await runPrintShippingSlip({
      connected: false,
      shipmentId: "ship-1",
      labelId: "lab-1",
      fetchSlipPdf,
      printPdf,
      queueAgentPrint,
    });
    expect(fetchSlipPdf).toHaveBeenCalledWith("lab-1");
    expect(printPdf).toHaveBeenCalledWith(blob);
    expect(queueAgentPrint).not.toHaveBeenCalled();
    expect(result).toEqual({ mode: "browser", message: "Opened the browser print dialog" });
  });
});
