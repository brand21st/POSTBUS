import metrics from "@/modules/labels/layout/helvetica-metrics.json";

export type FontWeight = "normal" | "bold";

type Glyph = {
  name: string;
  widths: readonly [number, number, number, number];
};

const glyphs = new Map<number, Glyph>();
metrics.codePoints.forEach((codePoint, index) => {
  const widths = metrics.widths[index];
  const name = metrics.names[index];
  if (!widths || !name) return;
  glyphs.set(codePoint, {
    name,
    widths: [widths[0] ?? 250, widths[1] ?? 250, widths[2] ?? 250, widths[3] ?? 250],
  });
});

const kernTables = metrics.kern as unknown as Array<Record<string, Record<string, number>>>;

function styleIndex(weight: FontWeight, italic: boolean) {
  if (weight === "bold" && italic) return 3;
  if (weight === "bold") return 1;
  if (italic) return 2;
  return 0;
}

/** Width in points, using the same WinAnsi widths and kerning as pdf-lib standard Helvetica. */
export function measureHelvetica(text: string, fontSize: number, weight: FontWeight = "normal", italic = false) {
  const index = styleIndex(weight, italic);
  const kern = kernTables[index] ?? {};
  let total = 0;
  let previous = "";
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    const glyph = codePoint == null ? undefined : glyphs.get(codePoint);
    if (!glyph) {
      previous = "";
      continue;
    }
    const pair = previous ? kern[previous]?.[glyph.name] ?? 0 : 0;
    total += glyph.widths[index] + pair;
    previous = glyph.name;
  }
  return (total * fontSize) / 1000;
}
