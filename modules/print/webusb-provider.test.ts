import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import { deviceKeyForUsb } from "@/modules/print/device-key";
import { WebUSBPrintingProvider, type WebUsbDevice, type WebUsbPort } from "@/modules/print/webusb-provider";
import {
  WEBUSB_PERMISSION,
  WEBUSB_PROTOCOL_LATER,
  WEBUSB_TEST_FAILED,
  WEBUSB_UNAVAILABLE,
  WEBUSB_UNSUPPORTED,
} from "@/modules/print/webusb-messages";

function device(partial: Partial<WebUsbDevice> = {}) {
  const endpoints = [{ direction: "out" as const, type: "bulk" as const, endpointNumber: 2 }];
  const interfaces = [{ interfaceNumber: 0, alternates: [{ interfaceClass: 255, endpoints }] }];
  let transfers = 0;
  const printer: WebUsbDevice = {
    vendorId: 0x0483,
    productId: 0x5740,
    productName: "Xprinter XP-420B",
    serialNumber: "SN1",
    opened: false,
    configuration: null,
    configurations: [{ configurationValue: 1, interfaces }],
    open: async () => {
      printer.opened = true;
    },
    close: async () => {
      printer.opened = false;
    },
    selectConfiguration: async () => {
      printer.configuration = { interfaces };
    },
    claimInterface: async () => undefined,
    releaseInterface: async () => undefined,
    transferOut: async () => {
      transfers += 1;
      return { status: "ok" };
    },
    ...partial,
  };
  return {
    printer,
    transfers: () => transfers,
    failNext() {
      printer.transferOut = async () => {
        transfers += 1;
        return { status: "stall" };
      };
    },
  };
}

function port(printer: WebUsbDevice, request?: () => Promise<WebUsbDevice>) {
  const listeners: Record<string, Array<(event: { device: WebUsbDevice }) => void>> = {
    connect: [],
    disconnect: [],
  };
  const usb: WebUsbPort = {
    requestDevice: request ?? (async () => printer),
    getDevices: async () => [printer],
    addEventListener(type, listener) {
      listeners[type].push(listener);
    },
  };
  return {
    usb,
    emit(type: "connect" | "disconnect") {
      for (const listener of listeners[type]) listener({ device: printer });
    },
  };
}

describe("WebUSB printing provider", () => {
  it("is unavailable when the browser has no USB API", async () => {
    const provider = new WebUSBPrintingProvider(null);
    expect(provider.isAvailable()).toBe(false);
    await expect(provider.connect()).rejects.toThrow(WEBUSB_UNAVAILABLE);
  });

  it("connects a supported printer and sends a test page only after the interface is open", async () => {
    const hardware = device();
    const provider = new WebUSBPrintingProvider(port(hardware.printer).usb);
    await provider.connect();
    expect(provider.getStatus().state).toBe("connected");
    expect(provider.getStatus().deviceName).toBe("Xprinter XP-420B");
    expect(hardware.transfers()).toBe(0);
    await provider.testPrint();
    expect(hardware.transfers()).toBe(1);
    const listed = await provider.getPrinters();
    expect(listed[0]).toEqual({
      name: "Xprinter XP-420B",
      deviceKey: await deviceKeyForUsb(hardware.printer),
    });
    expect(listed[0]).not.toHaveProperty("vendorId");
    expect(listed[0]).not.toHaveProperty("serialNumber");
  });

  it("does not send bytes to an unsupported or unimplemented printer", async () => {
    const unknown = device({ vendorId: 0x1234, productId: 0x99, productName: "Office Laser" });
    const unknownProvider = new WebUSBPrintingProvider(port(unknown.printer).usb);
    await expect(unknownProvider.connect()).rejects.toThrow(WEBUSB_UNSUPPORTED);
    expect(unknown.transfers()).toBe(0);
    expect(unknownProvider.getStatus().state).toBe("error");

    const zebra = device({ vendorId: 0x0a5f, productId: 0x1, productName: "Zebra" });
    const zebraProvider = new WebUSBPrintingProvider(port(zebra.printer).usb);
    await expect(zebraProvider.connect()).rejects.toThrow(WEBUSB_PROTOCOL_LATER);
    expect(zebra.transfers()).toBe(0);
  });

  it("reports permission denial, transfer failure, and disconnect without a stack", async () => {
    const denied = new WebUSBPrintingProvider(
      port(device().printer, async () => {
        const error = new Error("internal");
        error.name = "NotAllowedError";
        throw error;
      }).usb
    );
    await expect(denied.connect()).rejects.toThrow(WEBUSB_PERMISSION);
    expect(String(await denied.connect().catch((error: Error) => error.stack))).not.toMatch(/internal/);

    const hardware = device();
    const usb = port(hardware.printer);
    const provider = new WebUSBPrintingProvider(usb.usb);
    await provider.connect();
    hardware.failNext();
    await expect(provider.testPrint()).rejects.toThrow(WEBUSB_TEST_FAILED);
    expect(provider.getStatus().state).toBe("error");

    const live = device();
    const livePort = port(live.printer);
    const connected = new WebUSBPrintingProvider(livePort.usb);
    await connected.connect();
    livePort.emit("disconnect");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(connected.getStatus().state).toBe("disconnected");
  });

  it("hashes the USB identity without keeping the serial in the key text", async () => {
    const material = `${0x0483}:${0x5740}:SN1`;
    const key = await deviceKeyForUsb({ vendorId: 0x0483, productId: 0x5740, serialNumber: "SN1" });
    expect(key).toBe(createHash("sha256").update(material).digest("hex"));
    expect(key).not.toContain("SN1");
  });
});
