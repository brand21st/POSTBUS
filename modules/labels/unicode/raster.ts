import { logError } from "@/lib/logger";
import { loadCanvas, type SKRSContext2D } from "@/modules/labels/unicode/canvas-native";
import { cssFont, registerPaintFonts } from "@/modules/labels/unicode/fonts";
import { graphemes, sanitizeLabelText, segmentScriptRuns, type PaintScript } from "@/modules/labels/unicode/text";

export const PAINT_SCALE = 3;
const PAD_PX = 2;

type Weight = "normal" | "bold";

type ShapedRun = {
  text: string;
  script: Exclude<PaintScript, "common">;
  width: number;
};

let measureCtx: SKRSContext2D | null = null;

function context() {
  registerPaintFonts();
  if (!measureCtx) {
    const { createCanvas } = loadCanvas();
    measureCtx = createCanvas(4, 4).getContext("2d");
  }
  return measureCtx;
}

function runWidth(text: string, script: Exclude<PaintScript, "common">, sizePx: number, bold: boolean) {
  const ctx = context();
  ctx.font = cssFont(script, sizePx, bold);
  const width = ctx.measureText(text).width;
  if (width <= 0.01 && text.trim()) {
    logError("UNICODE_GLYPH_MISSING", {
      script,
      sample: text.slice(0, 40),
      codePoints: [...text].slice(0, 12).map((char) => (char.codePointAt(0) ?? 0).toString(16)),
    });
    ctx.font = cssFont("latin", sizePx, bold);
    return Math.max(ctx.measureText(text).width, ctx.measureText("\uFFFD").width * Math.max(1, graphemes(text).length));
  }
  return width;
}

export function shapedRuns(text: string, fontSizePt: number, weight: Weight = "normal"): ShapedRun[] {
  const sizePx = fontSizePt * PAINT_SCALE;
  const bold = weight === "bold";
  return segmentScriptRuns(text).map((run) => ({
    ...run,
    width: runWidth(run.text, run.script, sizePx, bold) / PAINT_SCALE,
  }));
}

export function measureShapedText(text: string, fontSizePt: number, weight: Weight = "normal") {
  return shapedRuns(text, fontSizePt, weight).reduce((sum, run) => sum + run.width, 0);
}

export function wrapShapedText(text: string, maxWidthPt: number, fontSizePt: number, weight: Weight = "normal") {
  const value = sanitizeLabelText(text);
  if (!value) return [""];
  const paragraphs = value.split(/\n/);
  return paragraphs.flatMap((paragraph) => wrapParagraph(paragraph, maxWidthPt, fontSizePt, weight));
}

function wrapParagraph(paragraph: string, maxWidthPt: number, fontSizePt: number, weight: Weight) {
  const words = paragraph.split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let current = "";
  const fits = (candidate: string) => measureShapedText(candidate, fontSizePt, weight) <= maxWidthPt + 0.01;
  const pushGraphemes = (word: string) => {
    let chunk = "";
    for (const unit of graphemes(word)) {
      const trial = chunk + unit;
      if (chunk && !fits(trial)) {
        lines.push(chunk);
        chunk = unit;
      } else {
        chunk = trial;
      }
    }
    return chunk;
  };
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (fits(next)) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = fits(word) ? word : pushGraphemes(word);
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export function rasterizeShapedLine(input: {
  text: string;
  fontSizePt: number;
  weight?: Weight;
  color: { r: number; g: number; b: number };
}) {
  const text = sanitizeLabelText(input.text);
  const fontSizePt = input.fontSizePt;
  const weight = input.weight ?? "normal";
  const sizePx = fontSizePt * PAINT_SCALE;
  const bold = weight === "bold";
  const runs = segmentScriptRuns(text);
  const ctx = context();
  let widthPx = PAD_PX * 2;
  let ascent = sizePx * 0.8;
  let descent = sizePx * 0.25;
  const measured = runs.map((run) => {
    ctx.font = cssFont(run.script, sizePx, bold);
    const metrics = ctx.measureText(run.text);
    ascent = Math.max(ascent, metrics.actualBoundingBoxAscent || sizePx * 0.8);
    descent = Math.max(descent, metrics.actualBoundingBoxDescent || sizePx * 0.25);
    const width = Math.max(0, metrics.width);
    widthPx += width;
    return { ...run, width };
  });
  const heightPx = Math.ceil(PAD_PX * 2 + ascent + descent);
  const { createCanvas } = loadCanvas();
  const canvas = createCanvas(Math.max(1, Math.ceil(widthPx)), Math.max(1, heightPx));
  const paint = canvas.getContext("2d");
  paint.clearRect(0, 0, canvas.width, canvas.height);
  paint.fillStyle = `rgb(${Math.round(input.color.r * 255)}, ${Math.round(input.color.g * 255)}, ${Math.round(input.color.b * 255)})`;
  let x = PAD_PX;
  const baseline = PAD_PX + ascent;
  for (const run of measured) {
    paint.font = cssFont(run.script, sizePx, bold);
    paint.fillText(run.text, x, baseline);
    x += run.width;
  }
  return {
    png: canvas.toBuffer("image/png"),
    widthPt: canvas.width / PAINT_SCALE,
    heightPt: canvas.height / PAINT_SCALE,
    baselineFromTopPt: baseline / PAINT_SCALE,
  };
}
