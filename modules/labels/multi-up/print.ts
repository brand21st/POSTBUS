import { isMultiPrintPaperId, type MultiPrintPaperId } from "@/modules/labels/page-presets";

export function multiUpPrintDecision(input: {
  sheetPaper: MultiPrintPaperId | "custom";
  agentPaper: string | null | undefined;
  connected: boolean;
}): { ok: true; paperSize: MultiPrintPaperId } | { ok: false; message: string } {
  if (input.sheetPaper === "custom" || !isMultiPrintPaperId(input.sheetPaper)) {
    return {
      ok: false,
      message: "Custom sheets can be previewed and downloaded. Printing needs a named paper size that matches the printer.",
    };
  }
  if (!input.connected) {
    return { ok: false, message: "Printer unavailable. Download the sheet PDF instead." };
  }
  if (input.agentPaper !== input.sheetPaper) {
    return {
      ok: false,
      message: `The printer is set to ${input.agentPaper || "another size"}. This sheet is ${input.sheetPaper}. Change the printer paper size, or download the PDF.`,
    };
  }
  return { ok: true, paperSize: input.sheetPaper };
}
