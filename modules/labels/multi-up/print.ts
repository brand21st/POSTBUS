import type { PaperSizeId } from "@/modules/labels/page-presets";

export function multiUpPrintDecision(input: {
  sheetPaper: PaperSizeId | "custom";
  agentPaper: string | null | undefined;
  connected: boolean;
}): { ok: true; paperSize: PaperSizeId } | { ok: false; message: string } {
  if (input.sheetPaper === "custom") {
    return {
      ok: false,
      message: "Custom sheets can be previewed and downloaded. Printing needs A6, 4×6, A5, or A4.",
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
