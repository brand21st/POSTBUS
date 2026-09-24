import { pagePreset } from "@/modules/labels/page-presets";

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
  { id: "receiver", label: "Receiver", x: 110, y: 188, width: 172, height: 84 },
  { id: "sender", label: "Sender", x: 110, y: 118, width: 172, height: 64 },
  { id: "qrCode", label: "QR code", x: 8, y: 162, width: 102, height: 108, coverOnCompose: true },
  { id: "bookingInfo", label: "Booking information", x: 16, y: 72, width: 130, height: 40 },
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
