export type ProtocolId = "tspl" | "zpl" | "escpos";

export type PrinterProfile = {
  protocol: ProtocolId;
  maxWidthMm: number;
  dpi: number;
};

export type UsbInterfaceInfo = {
  interfaceClass: number;
  hasBulkOut: boolean;
};

const XPRINTER_VENDORS = new Set([0x0483, 0x0416, 0x1fc9, 0x2d37]);
const ZEBRA_VENDOR = 0x0a5f;
const LABEL_NAME = /\b(xp[-\s]?4[0-9]{2}|xprinter|tsc)\b/i;
const RECEIPT_NAME = /\bxp[-\s]?(58|80|76)\b|\breceipt\b/i;

const KNOWN_LABEL: Record<string, PrinterProfile> = {
  "0483:5740": { protocol: "tspl", maxWidthMm: 108, dpi: 203 },
  "0483:5743": { protocol: "tspl", maxWidthMm: 108, dpi: 203 },
};

function hexId(vendorId: number, productId: number) {
  return `${vendorId.toString(16).padStart(4, "0")}:${productId.toString(16).padStart(4, "0")}`;
}

export function detectPrintProtocol(input: {
  vendorId: number;
  productId: number;
  productName?: string | null;
  interfaces: UsbInterfaceInfo[];
}): PrinterProfile | null {
  if (!input.interfaces.some((item) => item.hasBulkOut)) return null;
  const name = input.productName?.trim() ?? "";
  if (RECEIPT_NAME.test(name) && !LABEL_NAME.test(name)) return null;

  const known = KNOWN_LABEL[hexId(input.vendorId, input.productId)];
  if (known) {
    if (!name || !LABEL_NAME.test(name)) return null;
    return known;
  }

  if (XPRINTER_VENDORS.has(input.vendorId) && LABEL_NAME.test(name)) {
    return { protocol: "tspl", maxWidthMm: 108, dpi: 203 };
  }

  if (input.vendorId === ZEBRA_VENDOR) {
    return { protocol: "zpl", maxWidthMm: 104, dpi: 203 };
  }

  return null;
}
