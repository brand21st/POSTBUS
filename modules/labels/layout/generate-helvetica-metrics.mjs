import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Font, Encodings } = require("@pdf-lib/standard-fonts");

const faces = ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"].map((name) =>
  Font.load(name)
);
const codePoints = Encodings.WinAnsi.supportedCodePoints;
const names = [];
const widths = [];
for (const codePoint of codePoints) {
  const glyph = Encodings.WinAnsi.encodeUnicodeCodePoint(codePoint);
  names.push(glyph.name);
  widths.push(
    faces.map((face) => {
      const width = face.getWidthOfGlyph(glyph.name);
      return width || 250;
    })
  );
}
const kern = faces.map((face) => face.KernPairXAmounts);
const payload = { codePoints, names, widths, kern };
writeFileSync(new URL("./helvetica-metrics.json", import.meta.url), JSON.stringify(payload));
console.log(`wrote ${codePoints.length} glyphs`);
