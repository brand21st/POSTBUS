import { existsSync } from "node:fs";
import path from "node:path";
import { GlobalFonts } from "@napi-rs/canvas";
import { logError } from "@/lib/logger";
import type { PaintScript } from "@/modules/labels/unicode/text";

export type PaintFamily = Exclude<PaintScript, "common">;

const FILES: Record<PaintFamily, { regular: string; bold: string; family: string }> = {
  latin: { regular: "NotoSans-Regular.woff", bold: "NotoSans-Bold.woff", family: "Postbus Noto Sans" },
  malayalam: {
    regular: "NotoSansMalayalam-Regular.woff",
    bold: "NotoSansMalayalam-Bold.woff",
    family: "Postbus Noto Sans Malayalam",
  },
  devanagari: {
    regular: "NotoSansDevanagari-Regular.woff",
    bold: "NotoSansDevanagari-Bold.woff",
    family: "Postbus Noto Sans Devanagari",
  },
  tamil: { regular: "NotoSansTamil-Regular.woff", bold: "NotoSansTamil-Bold.woff", family: "Postbus Noto Sans Tamil" },
  kannada: {
    regular: "NotoSansKannada-Regular.woff",
    bold: "NotoSansKannada-Bold.woff",
    family: "Postbus Noto Sans Kannada",
  },
  telugu: { regular: "NotoSansTelugu-Regular.woff", bold: "NotoSansTelugu-Bold.woff", family: "Postbus Noto Sans Telugu" },
  bengali: {
    regular: "NotoSansBengali-Regular.woff",
    bold: "NotoSansBengali-Bold.woff",
    family: "Postbus Noto Sans Bengali",
  },
  gujarati: {
    regular: "NotoSansGujarati-Regular.woff",
    bold: "NotoSansGujarati-Bold.woff",
    family: "Postbus Noto Sans Gujarati",
  },
  gurmukhi: {
    regular: "NotoSansGurmukhi-Regular.woff",
    bold: "NotoSansGurmukhi-Bold.woff",
    family: "Postbus Noto Sans Gurmukhi",
  },
  oriya: { regular: "NotoSansOriya-Regular.woff", bold: "NotoSansOriya-Bold.woff", family: "Postbus Noto Sans Oriya" },
};

let registered = false;

function fontDirectories() {
  return [
    path.join(process.cwd(), "assets/fonts/noto"),
    path.resolve(__dirname, "../../../assets/fonts/noto"),
  ];
}

export function notoFontDirectory() {
  return fontDirectories().find((dir) => existsSync(path.join(dir, FILES.latin.regular))) ?? fontDirectories()[0];
}

export function registerPaintFonts() {
  if (registered) return;
  const dir = notoFontDirectory();
  for (const spec of Object.values(FILES)) {
    const regular = path.join(dir, spec.regular);
    const bold = path.join(dir, spec.bold);
    if (!existsSync(regular)) {
      logError("UNICODE_FONT_MISSING", { family: spec.family, file: spec.regular, dir });
      continue;
    }
    GlobalFonts.registerFromPath(regular, spec.family);
    if (existsSync(bold)) GlobalFonts.registerFromPath(bold, spec.family);
  }
  registered = true;
}

export function familyForScript(script: PaintFamily) {
  registerPaintFonts();
  return FILES[script].family;
}

export function cssFont(script: PaintFamily, sizePx: number, bold: boolean) {
  const weight = bold ? 700 : 400;
  return `${weight} ${sizePx}px "${familyForScript(script)}"`;
}
