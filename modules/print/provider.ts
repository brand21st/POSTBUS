export type PrinterConnectionState = "disconnected" | "connecting" | "connected" | "error";

export type PrintingStatus = {
  state: PrinterConnectionState;
  message: string | null;
  deviceKey: string | null;
  deviceName: string | null;
};

export type LivePrinter = {
  name: string;
  deviceKey: string;
};

export interface PrintingProvider {
  readonly connectionType: "webusb" | "agent";
  isAvailable(): boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getPrinters(): Promise<LivePrinter[]>;
  getStatus(): PrintingStatus;
  testPrint(): Promise<void>;
  printLabel(pdf: Uint8Array, copies?: number): Promise<void>;
}
