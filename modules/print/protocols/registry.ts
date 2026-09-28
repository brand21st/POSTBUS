import { packMonoBitmap } from "@/modules/print/raster-plan";

export type ProtocolId = "tspl" | "zpl" | "escpos";

export type PrintingProtocol = {
  id: ProtocolId;
  implemented: boolean;
  prepareTestPage(): Uint8Array;
  prepareLabelBitmap(input: {
    rgba: Uint8ClampedArray;
    widthPx: number;
    heightPx: number;
    paddedWidthPx: number;
    widthMm: number;
    heightMm: number;
    copies: number;
  }): Uint8Array;
};

function text(value: string) {
  return new TextEncoder().encode(value);
}

function concat(parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function mm(value: number) {
  return (Math.round(value * 10) / 10).toFixed(1);
}

export const tsplProtocol: PrintingProtocol = {
  id: "tspl",
  implemented: true,
  prepareTestPage() {
    return text(
      ['SIZE 70 mm, 30 mm', "GAP 2 mm, 0 mm", "DIRECTION 1", "CLS", 'TEXT 20,20,"0",0,1,1,"PostBus test"', "PRINT 1,1", ""].join(
        "\r\n"
      )
    );
  },
  prepareLabelBitmap(input) {
    const copies = Math.min(5, Math.max(1, Math.round(input.copies) || 1));
    const bitmap = packMonoBitmap(input.rgba, input.widthPx, input.heightPx, input.paddedWidthPx);
    const widthBytes = input.paddedWidthPx / 8;
    const header = text(
      [
        `SIZE ${mm(input.widthMm)} mm, ${mm(input.heightMm)} mm`,
        "GAP 2 mm, 0 mm",
        "DIRECTION 1",
        "CLS",
        `BITMAP 0,0,${widthBytes},${input.heightPx},0,`,
      ].join("\r\n")
    );
    return concat([header, bitmap, text(`\r\nPRINT 1,${copies}\r\n`)]);
  },
};

const unimplemented = (id: ProtocolId): PrintingProtocol => ({
  id,
  implemented: false,
  prepareTestPage() {
    throw new Error("This printer is not supported for direct USB printing yet. Use the PostBus Print Agent.");
  },
  prepareLabelBitmap() {
    throw new Error("This printer is not supported for direct USB printing yet. Use the PostBus Print Agent.");
  },
});

const PROTOCOLS: Record<ProtocolId, PrintingProtocol> = {
  tspl: tsplProtocol,
  zpl: unimplemented("zpl"),
  escpos: unimplemented("escpos"),
};

export function protocolFor(id: ProtocolId) {
  return PROTOCOLS[id] ?? null;
}
