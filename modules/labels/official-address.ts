import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { indiaPostPartyOverlayRect } from "@/modules/labels/official-elements";

export type OfficialPartyBox = {
  receiverName: string;
  receiverLines: string[];
  senderName: string;
  senderLines: string[];
  paymentLabel?: string | null;
};

function wrapToWidth(font: PDFFont, text: string, size: number, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  const pushLong = (value: string) => {
    let rest = value;
    while (rest.length) {
      let cut = rest.length;
      while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
  };
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) current = next;
    else {
      if (current) lines.push(current);
      if (font.widthOfTextAtSize(word, size) <= maxWidth) current = word;
      else {
        pushLong(word);
        current = "";
      }
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function heading(label: string, name: string) {
  return `${label}:${name}`.trim();
}

/** Rewrites the CEPT RECEIVER/SENDER box without covering the QR or booking footer. */
export async function overlayIndiaPostPartyBox(officialPdf: Uint8Array | Buffer, box: OfficialPartyBox) {
  const document = await PDFDocument.load(officialPdf, { ignoreEncryption: true });
  const page = document.getPages()[0];
  if (!page) return new Uint8Array(officialPdf);
  const size = page.getSize();
  const rect = indiaPostPartyOverlayRect(size.width, size.height);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    color: rgb(1, 1, 1),
  });
  const pad = Math.max(3, Math.min(6, rect.width * 0.04));
  const textWidth = Math.max(12, rect.width - pad * 2);
  const innerHeight = Math.max(12, rect.height - pad * 2);

  const layout = (sizePt: number) => {
    const wrap = (text: string) => wrapToWidth(font, text, sizePt, textWidth);
    const receiver = [
      heading("RECEIVER", box.receiverName),
      ...box.receiverLines,
      box.paymentLabel?.trim() || "",
    ]
      .flatMap((line) => wrap(line))
      .filter(Boolean);
    const sender = [heading("SENDER", box.senderName), ...box.senderLines]
      .flatMap((line) => wrap(line))
      .filter(Boolean);
    const gap = sizePt + 1.15;
    const needed = (receiver.length + sender.length) * gap + gap;
    return { receiver, sender, gap, needed, sizePt };
  };

  let fitted = layout(6.5);
  for (const sizePt of [6.5, 6, 5.5, 5]) {
    fitted = layout(sizePt);
    if (fitted.needed <= innerHeight) break;
  }

  let cursor = rect.y + rect.height - pad - fitted.sizePt;
  const floor = rect.y + pad;
  const draw = (line: string, headingLine: boolean) => {
    if (cursor < floor) return false;
    page.drawText(line, {
      x: rect.x + pad,
      y: cursor,
      size: fitted.sizePt,
      font: headingLine ? bold : font,
      color: rgb(0, 0, 0),
      maxWidth: textWidth,
    });
    cursor -= fitted.gap;
    return true;
  };
  fitted.receiver.forEach((line, index) => draw(line, index === 0));
  cursor -= fitted.gap * 0.35;
  fitted.sender.forEach((line, index) => draw(line, index === 0));
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
