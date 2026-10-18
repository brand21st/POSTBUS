export type AgentPrintResult = {
  message?: string;
  job?: { printerName?: string | null; printer_name?: string | null };
};

export async function runPrintShippingSlip(input: {
  connected: boolean;
  shipmentId: string;
  labelId: string;
  queueName?: string | null;
  fetchSlipPdf: (labelId: string) => Promise<Blob>;
  printPdf: (blob: Blob) => void | Promise<void>;
  queueAgentPrint: (shipmentId: string) => Promise<AgentPrintResult>;
}) {
  if (!input.connected) {
    const blob = await input.fetchSlipPdf(input.labelId);
    await input.printPdf(blob);
    return { mode: "browser" as const, message: "Opened the browser print dialog" };
  }
  const queued = await input.queueAgentPrint(input.shipmentId);
  const queue =
    queued.job?.printerName || queued.job?.printer_name || input.queueName?.trim() || "";
  return {
    mode: "agent" as const,
    message: queue ? `Queued for ${queue}` : queued.message || "Queued for the Print Agent.",
  };
}
