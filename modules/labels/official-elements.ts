import { officialDrawRect, pagePreset } from "@/modules/labels/page-presets";

export type OfficialLockedElement = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  coverOnCompose?: boolean;
};

/** Display-only hitboxes on a typical CEPT A6 page (PDF points, origin bottom-left). */
export const OFFICIAL_LOCKED_ELEMENTS: OfficialLockedElement[] = [
  { id: "indiaPostLogo", label: "India Post Logo", x: 12, y: 372, width: 88, height: 36 },
  { id: "originOffice", label: "Origin / booking office", x: 108, y: 372, width: 90, height: 36 },
  { id: "destinationPin", label: "Destination / PIN", x: 204, y: 372, width: 82, height: 36 },
  { id: "barcode", label: "Barcode", x: 20, y: 300, width: 258, height: 64 },
  { id: "trackingNumber", label: "Tracking number", x: 20, y: 278, width: 180, height: 18 },
  { id: "serviceText", label: "Service text", x: 204, y: 278, width: 74, height: 18 },
  { id: "pinRange", label: "PIN range", x: 18, y: 254, width: 262, height: 22 },
  { id: "qrCode", label: "QR code", x: 12, y: 140, width: 112, height: 112, coverOnCompose: true },
  { id: "receiver", label: "Receiver", x: 132, y: 198, width: 150, height: 54 },
  { id: "sender", label: "Sender", x: 132, y: 140, width: 150, height: 54 },
  { id: "bookingInfo", label: "Booking information", x: 14, y: 46, width: 270, height: 84 },
  { id: "weight", label: "Weight", x: 152, y: 72, width: 126, height: 40 },
  { id: "amount", label: "Amount", x: 16, y: 36, width: 120, height: 28 },
  { id: "contract", label: "Contract / customer ID", x: 140, y: 36, width: 140, height: 28 },
  { id: "grievance", label: "Grievance information", x: 16, y: 8, width: 264, height: 24 },
];

export function visibleOfficialElements() {
  return OFFICIAL_LOCKED_ELEMENTS.filter((item) => !item.coverOnCompose);
}

export function coveredOfficialElements() {
  return OFFICIAL_LOCKED_ELEMENTS.filter((item) => item.coverOnCompose);
}

export function mapOfficialRect(
  rect: { x: number; y: number; width: number; height: number },
  placed: { x: number; y: number; width: number; height: number },
  sourceWidthPt = pagePreset("A6").widthPt,
  sourceHeightPt = pagePreset("A6").heightPt
) {
  return {
    x: placed.x + (rect.x / sourceWidthPt) * placed.width,
    y: placed.y + (rect.y / sourceHeightPt) * placed.height,
    width: (rect.width / sourceWidthPt) * placed.width,
    height: (rect.height / sourceHeightPt) * placed.height,
  };
}

export function officialElement(id: string) {
  const found = OFFICIAL_LOCKED_ELEMENTS.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown official label element: ${id}`);
  return found;
}

/** Address rewrite box: right of the QR, above the booking footer, below the PIN strip. */
export function indiaPostPartyOverlayRect(pageWidth: number, pageHeight: number) {
  const a6 = pagePreset("A6");
  const placed = officialDrawRect(pageWidth, pageHeight, a6.widthPt, a6.heightPt);
  const qr = mapOfficialRect(officialElement("qrCode"), placed);
  const booking = mapOfficialRect(officialElement("bookingInfo"), placed);
  const pin = mapOfficialRect(officialElement("pinRange"), placed);
  const receiver = mapOfficialRect(officialElement("receiver"), placed);
  const sender = mapOfficialRect(officialElement("sender"), placed);
  const scale = placed.width / a6.widthPt;
  const gap = 8 * scale;
  const x = qr.x + qr.width + gap;
  const y = Math.max(Math.min(qr.y, sender.y), booking.y + booking.height + gap);
  // CEPT can render the first receiver line at the very top of its mapped
  // receiver box. Cover that full band while retaining the template's gap
  // before the PIN strip.
  const top = Math.min(pin.y, Math.max(qr.y + qr.height, receiver.y + receiver.height));
  const right = placed.x + placed.width - 12 * scale;
  return {
    x,
    y,
    width: Math.max(24, right - x),
    height: Math.max(24, top - y),
  };
}
