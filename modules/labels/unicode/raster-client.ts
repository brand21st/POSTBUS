import { measureHelvetica, type FontWeight } from "@/modules/labels/layout/measure";
import { graphemes, sanitizeLabelText } from "@/modules/labels/unicode/text";

type Weight = FontWeight;

function widthOf(text: string, fontSizePt: number, weight: Weight) {
  return measureHelvetica(text, fontSizePt, weight, false);
}

export function measureShapedText(text: string, fontSizePt: number, weight: Weight = "normal") {
  return widthOf(sanitizeLabelText(text), fontSizePt, weight);
}

export function wrapShapedText(text: string, maxWidthPt: number, fontSizePt: number, weight: Weight = "normal") {
  const value = sanitizeLabelText(text);
  if (!value) return [""];
  return value.split(/\n/).flatMap((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) return [""];
    const lines: string[] = [];
    let current = "";
    const fits = (candidate: string) => widthOf(candidate, fontSizePt, weight) <= maxWidthPt + 0.01;
    const pushGraphemes = (word: string) => {
      let chunk = "";
      for (const unit of graphemes(word)) {
        const trial = chunk + unit;
        if (chunk && !fits(trial)) {
          lines.push(chunk);
          chunk = unit;
        } else chunk = trial;
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
  });
}

export function rasterizeShapedLine(_input: {
  text: string;
  fontSizePt: number;
  weight?: Weight;
  color: { r: number; g: number; b: number };
}): never {
  throw new Error("Unicode label painting runs on the server");
}
