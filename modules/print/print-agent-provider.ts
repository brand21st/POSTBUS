import type { LivePrinter, PrintingProvider, PrintingStatus } from "@/modules/print/provider";

/**
 * Phase 2 extension point. The Windows .exe and macOS .dmg agent will implement
 * this provider. Today the packing-computer agent still claims `agent` jobs
 * through the existing token API; this class does not print by itself.
 */
export class PrintAgentProvider implements PrintingProvider {
  readonly connectionType = "agent" as const;

  isAvailable() {
    return false;
  }

  async connect() {
    throw new Error("The PostBus Print Agent runs on the packing computer.");
  }

  async disconnect() {}

  async getPrinters(): Promise<LivePrinter[]> {
    return [];
  }

  getStatus(): PrintingStatus {
    return { state: "disconnected", message: null, deviceKey: null, deviceName: null };
  }

  async testPrint() {
    throw new Error("The PostBus Print Agent runs on the packing computer.");
  }

  async printLabel() {
    throw new Error("The PostBus Print Agent runs on the packing computer.");
  }
}
