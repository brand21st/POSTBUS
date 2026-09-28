import { deviceKeyForUsb } from "@/modules/print/device-key";
import { detectPrintProtocol, type UsbInterfaceInfo } from "@/modules/print/protocols/detect";
import { protocolFor } from "@/modules/print/protocols/registry";
import type { LivePrinter, PrintingProvider, PrintingStatus, PrinterConnectionState } from "@/modules/print/provider";
import { rasterizeLabelPdf } from "@/modules/print/rasterize-label";
import {
  WEBUSB_DISCONNECTED,
  WEBUSB_INTERFACE,
  WEBUSB_PRINT_FAILED,
  WEBUSB_PROTOCOL_LATER,
  WEBUSB_TEST_FAILED,
  WEBUSB_UNAVAILABLE,
  WEBUSB_UNSUPPORTED,
  customerPrintError,
} from "@/modules/print/webusb-messages";

type UsbEndpoint = {
  direction?: string;
  type?: string;
  endpointNumber: number;
};

type UsbAlternate = {
  interfaceClass?: number;
  endpoints?: UsbEndpoint[];
};

export type WebUsbInterface = {
  interfaceNumber: number;
  alternate?: UsbAlternate;
  alternates?: UsbAlternate[];
};

export type WebUsbConfiguration = {
  configurationValue: number;
  interfaces: WebUsbInterface[];
};

export type WebUsbDevice = {
  vendorId: number;
  productId: number;
  productName?: string | null;
  serialNumber?: string | null;
  opened: boolean;
  configuration: { interfaces: WebUsbInterface[] } | null;
  configurations?: WebUsbConfiguration[];
  open: () => Promise<void>;
  close: () => Promise<void>;
  selectConfiguration: (configurationValue: number) => Promise<void>;
  claimInterface: (interfaceNumber: number) => Promise<void>;
  releaseInterface: (interfaceNumber: number) => Promise<void>;
  transferOut: (endpointNumber: number, data: BufferSource) => Promise<{ status: string }>;
};

type UsbConnectEvent = { device: WebUsbDevice };

export type WebUsbPort = {
  requestDevice: (options: { filters: Record<string, never>[] }) => Promise<WebUsbDevice>;
  getDevices: () => Promise<WebUsbDevice[]>;
  addEventListener?: (type: "connect" | "disconnect", listener: (event: UsbConnectEvent) => void) => void;
  removeEventListener?: (type: "connect" | "disconnect", listener: (event: UsbConnectEvent) => void) => void;
};

function alternatesOf(iface: WebUsbInterface) {
  if (iface.alternates?.length) return iface.alternates;
  return iface.alternate ? [iface.alternate] : [];
}

export function interfaceInfos(device: WebUsbDevice): UsbInterfaceInfo[] {
  const interfaces = device.configuration?.interfaces ?? device.configurations?.[0]?.interfaces ?? [];
  return interfaces.map((iface) => {
    const alternate = alternatesOf(iface)[0];
    const endpoints = alternate?.endpoints ?? [];
    return {
      interfaceClass: alternate?.interfaceClass ?? 0xff,
      hasBulkOut: endpoints.some((endpoint) => endpoint.direction === "out" && endpoint.type === "bulk"),
    };
  });
}

function bulkOut(device: WebUsbDevice) {
  const interfaces = device.configuration?.interfaces ?? [];
  for (const iface of interfaces) {
    for (const alternate of alternatesOf(iface)) {
      const endpoint = alternate.endpoints?.find((item) => item.direction === "out" && item.type === "bulk");
      if (endpoint) return { interfaceNumber: iface.interfaceNumber, endpointNumber: endpoint.endpointNumber };
    }
  }
  return null;
}

export class WebUSBPrintingProvider implements PrintingProvider {
  readonly connectionType = "webusb" as const;
  private device: WebUsbDevice | null = null;
  private endpoint: number | null = null;
  private interfaceNumber: number | null = null;
  private profile: { protocol: "tspl" | "zpl" | "escpos"; maxWidthMm: number; dpi: number } | null = null;
  private state: PrinterConnectionState = "disconnected";
  private message: string | null = null;
  private deviceKey: string | null = null;
  private deviceName: string | null = null;
  private watchedKey: string | null = null;
  private listeners = new Set<() => void>();
  private opening: Promise<void> | null = null;

  constructor(private readonly port: WebUsbPort | null) {
    port?.addEventListener?.("disconnect", (event) => {
      void this.onDisconnect(event.device);
    });
    port?.addEventListener?.("connect", (event) => {
      void this.onConnect(event.device);
    });
  }

  isAvailable() {
    return Boolean(this.port);
  }

  getStatus(): PrintingStatus {
    return { state: this.state, message: this.message, deviceKey: this.deviceKey, deviceName: this.deviceName };
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async connect() {
    if (!this.port) throw new Error(WEBUSB_UNAVAILABLE);
    this.setState("connecting", null);
    try {
      const device = await this.port.requestDevice({ filters: [] });
      await this.open(device);
    } catch (error) {
      if (this.state === "connecting") this.setState("error", customerPrintError(error, WEBUSB_UNSUPPORTED));
      throw new Error(customerPrintError(error, WEBUSB_UNSUPPORTED));
    }
  }

  async disconnect() {
    await this.release();
    this.setState("disconnected", null);
  }

  async getPrinters(): Promise<LivePrinter[]> {
    if (!this.port) return [];
    const devices = await this.port.getDevices();
    const printers: LivePrinter[] = [];
    for (const device of devices) {
      printers.push({
        name: device.productName?.trim() || "USB printer",
        deviceKey: await deviceKeyForUsb(device),
      });
    }
    return printers;
  }

  async syncSaved(deviceKey: string | null) {
    this.watchedKey = deviceKey;
    if (!this.port || !deviceKey) {
      if (this.state === "connected") await this.disconnect();
      return;
    }
    if (this.deviceKey === deviceKey && this.state === "connected") return;
    const devices = await this.port.getDevices();
    for (const device of devices) {
      if ((await deviceKeyForUsb(device)) === deviceKey) {
        await this.open(device).catch(() => undefined);
        return;
      }
    }
    if (this.deviceKey === deviceKey) await this.release();
    this.setState("disconnected", null);
  }

  async testPrint() {
    const protocol = this.requireProtocol();
    if (!protocol.implemented) throw new Error(WEBUSB_PROTOCOL_LATER);
    try {
      await this.write(protocol.prepareTestPage(), WEBUSB_TEST_FAILED);
    } catch (error) {
      this.setState("error", WEBUSB_TEST_FAILED);
      throw new Error(customerPrintError(error, WEBUSB_TEST_FAILED));
    }
  }

  async printLabel(pdf: Uint8Array, copies = 1) {
    const protocol = this.requireProtocol();
    if (!protocol.implemented || !this.profile) throw new Error(WEBUSB_PROTOCOL_LATER);
    let raster;
    try {
      raster = await rasterizeLabelPdf(pdf, this.profile.maxWidthMm, this.profile.dpi);
    } catch (error) {
      throw new Error(customerPrintError(error, WEBUSB_PRINT_FAILED));
    }
    const bytes = protocol.prepareLabelBitmap({
      rgba: raster.rgba,
      widthPx: raster.widthPx,
      heightPx: raster.heightPx,
      paddedWidthPx: raster.plan.paddedWidthPx,
      widthMm: raster.plan.widthMm,
      heightMm: raster.plan.heightMm,
      copies,
    });
    try {
      await this.write(bytes, WEBUSB_PRINT_FAILED);
    } catch (error) {
      this.setState("error", WEBUSB_PRINT_FAILED);
      throw new Error(customerPrintError(error, WEBUSB_PRINT_FAILED));
    }
  }

  async open(device: WebUsbDevice) {
    if (this.opening) return this.opening;
    this.opening = this.openNow(device).finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  private async openNow(device: WebUsbDevice) {
    if (!this.port) throw new Error(WEBUSB_UNAVAILABLE);
    this.setState("connecting", null);
    try {
      if (this.device && this.device !== device) await this.release();
      if (!device.opened) await device.open();
      if (!device.configuration) {
        const configuration = device.configurations?.[0];
        if (!configuration) throw new Error(WEBUSB_INTERFACE);
        await device.selectConfiguration(configuration.configurationValue);
      }
      const target = bulkOut(device);
      if (!target) throw new Error(WEBUSB_INTERFACE);
      await device.claimInterface(target.interfaceNumber);
      const profile = detectPrintProtocol({
        vendorId: device.vendorId,
        productId: device.productId,
        productName: device.productName,
        interfaces: interfaceInfos(device),
      });
      const adapter = profile ? protocolFor(profile.protocol) : null;
      if (!profile || !adapter?.implemented) {
        await device.releaseInterface(target.interfaceNumber).catch(() => undefined);
        await device.close().catch(() => undefined);
        const message = profile ? WEBUSB_PROTOCOL_LATER : WEBUSB_UNSUPPORTED;
        this.device = null;
        this.endpoint = null;
        this.interfaceNumber = null;
        this.profile = null;
        this.deviceKey = null;
        this.deviceName = null;
        this.setState("error", message);
        throw new Error(message);
      }
      this.device = device;
      this.endpoint = target.endpointNumber;
      this.interfaceNumber = target.interfaceNumber;
      this.profile = profile;
      this.deviceKey = await deviceKeyForUsb(device);
      this.deviceName = device.productName?.trim() || "USB printer";
      this.setState("connected", null);
    } catch (error) {
      if (this.state !== "error") {
        this.setState("error", customerPrintError(error, WEBUSB_INTERFACE));
      }
      throw new Error(customerPrintError(error, WEBUSB_INTERFACE));
    }
  }

  private requireProtocol() {
    if (!this.device || this.endpoint == null || !this.profile || this.state !== "connected") {
      throw new Error(WEBUSB_DISCONNECTED);
    }
    const protocol = protocolFor(this.profile.protocol);
    if (!protocol) throw new Error(WEBUSB_UNSUPPORTED);
    return protocol;
  }

  private async write(bytes: Uint8Array, failureMessage: string) {
    const device = this.device;
    const endpoint = this.endpoint;
    if (!device || endpoint == null) throw new Error(WEBUSB_DISCONNECTED);
    const chunkSize = 4096;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      const result = await device.transferOut(endpoint, new Uint8Array(chunk));
      if (result.status !== "ok") throw new Error(failureMessage);
    }
  }

  private async release() {
    const device = this.device;
    const interfaceNumber = this.interfaceNumber;
    this.device = null;
    this.endpoint = null;
    this.interfaceNumber = null;
    this.profile = null;
    this.deviceKey = null;
    this.deviceName = null;
    if (!device) return;
    if (interfaceNumber != null) {
      await device.releaseInterface(interfaceNumber).catch(() => undefined);
    }
    await device.close().catch(() => undefined);
  }

  private async onDisconnect(device: WebUsbDevice) {
    if (!this.device) return;
    const key = await deviceKeyForUsb(device);
    if (key !== this.deviceKey) return;
    await this.release();
    this.setState("disconnected", null);
  }

  private async onConnect(device: WebUsbDevice) {
    if (!this.watchedKey) return;
    const key = await deviceKeyForUsb(device);
    if (key !== this.watchedKey) return;
    await this.open(device).catch(() => undefined);
  }

  private setState(state: PrinterConnectionState, message: string | null) {
    this.state = state;
    this.message = message;
    for (const listener of this.listeners) listener();
  }
}

let singleton: WebUSBPrintingProvider | null = null;

export function getWebusbProvider() {
  if (!singleton) {
    const port = typeof navigator !== "undefined" && "usb" in navigator ? (navigator.usb as unknown as WebUsbPort) : null;
    singleton = new WebUSBPrintingProvider(port);
  }
  return singleton;
}
