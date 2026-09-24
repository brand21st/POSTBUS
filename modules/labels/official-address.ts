import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { OFFICIAL_LOCKED_ELEMENTS } from "@/modules/labels/official-elements";
import { pagePreset } from "@/modules/labels/page-presets";

export type OfficialPartyBox = {
  receiverName: string;
  receiverLines: string[];
  senderName: string;
  senderLines: string[];
  paymentLabel?: string | null;
};

function wrap(text: string, maxChars: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Rewrites the CEPT A6 RECEIVER/SENDER box so street, pin, phone and Prepaid/COD stay readable. */
export async function overlayIndiaPostPartyBox(officialPdf: Uint8Array | Buffer, box: OfficialPartyBox) {
  const document = await PDFDocument.load(officialPdf, { ignoreEncryption: true });
  const page = document.getPages()[0];
  if (!page) return new Uint8Array(officialPdf);
  const size = page.getSize();
  const a6 = pagePreset("A6");
  const sx = size.width / a6.widthPt;
  const sy = size.height / a6.heightPt;
  const receiver = OFFICIAL_LOCKED_ELEMENTS.find((item) => item.id === "receiver")!;
  const sender = OFFICIAL_LOCKED_ELEMENTS.find((item) => item.id === "sender")!;
  const x = Math.min(receiver.x, sender.x) * sx;
  const y = Math.min(receiver.y, sender.y) * sy;
  const width = Math.max(receiver.x + receiver.width, sender.x + sender.width) * sx - x;
  const height = Math.max(receiver.y + receiver.height, sender.y + sender.height) * sy - y;
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({
    x: x + 1,
    y: y + 1,
    width: width - 2,
    height: height - 2,
    color: rgb(1, 1, 1),
  });
  const textWidth = width - 8;
  const maxChars = Math.max(18, Math.floor(textWidth / 4.2));
  const receiverBlock = [
    `RECEIVER:${box.receiverName}`,
    ...box.receiverLines,
    box.paymentLabel?.trim() || "",
  ]
    .flatMap((line) => wrap(line, maxChars))
    .filter(Boolean);
  const senderBlock = [`SENDER:${box.senderName}`, ...box.senderLines]
    .flatMap((line) => wrap(line, maxChars))
    .filter(Boolean);
  const sizePt = 6.5;
  const gap = sizePt + 1.4;
  let cursor = y + height - 10;
  const draw = (line: string, heading: boolean) => {
    if (cursor < y + 4) return;
    page.drawText(line, {
      x: x + 4,
      y: cursor,
      size: sizePt,
      font: heading ? bold : font,
      color: rgb(0, 0, 0),
      maxWidth: textWidth,
    });
    cursor -= gap;
  };
  receiverBlock.forEach((line, index) => draw(line, index === 0));
  cursor -= 3;
  senderBlock.forEach((line, index) => draw(line, index === 0));
  return document.save();
}

export function officialAddressLines(input: {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  pin?: string | null;
  mobile?: string | null;
}) {
  const street = [input.line1, input.line2]
    .map((value) => (value ?? "").trim())
    .filter((value) => value.length > 0 && !/^registered\s*pickup$/i.test(value));
  const locality = [input.city, input.state].map((value) => (value ?? "").trim()).filter(Boolean).join(", ");
  const pin = (input.pin ?? "").trim();
  const phone = input.mobile ? `Ph: ${input.mobile}` : "";
  return [...street, locality, pin ? `- ${pin}` : "", phone].filter(Boolean);
}
