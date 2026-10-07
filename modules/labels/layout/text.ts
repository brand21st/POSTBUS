import { measureHelvetica, type FontWeight } from "@/modules/labels/layout/measure";
import { graphemes } from "@/modules/labels/unicode/text";

export const HELVETICA_ASCENDER = 718;

export type TextRun = {
  text: string;
  bold: boolean;
  italic: boolean;
};

export type PlacedRun = TextRun & {
  x: number;
  width: number;
};

export type PlacedLine = {
  text: string;
  x: number;
  baseline: number;
  width: number;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  runs: PlacedRun[];
};

export function lineStep(fontSize: number, extra: number) {
  return fontSize + extra;
}

export function baselineOffset(fontSize: number) {
  return (fontSize * HELVETICA_ASCENDER) / 1000;
}

export function wrapRuns(
  runs: TextRun[],
  maxWidth: number,
  measure: (text: string, run: Pick<TextRun, "bold" | "italic">) => number
): TextRun[][] {
  if (maxWidth <= 0) return runs.some((run) => run.text.length > 0) ? [runs] : [];
  const tokens: TextRun[] = [];
  for (const run of runs) {
    for (const part of run.text.split(/(\s+)/).filter((part) => part.length > 0)) {
      tokens.push({ text: part, bold: run.bold, italic: run.italic });
    }
  }
  const lines: TextRun[][] = [];
  let line: TextRun[] = [];
  let used = 0;
  const commit = () => {
    while (line.length && /^\s+$/.test(line[line.length - 1]?.text ?? "")) line.pop();
    if (line.length) lines.push(line);
    line = [];
    used = 0;
  };
  for (const token of tokens) {
    const space = /^\s+$/.test(token.text);
    const width = measure(token.text, token);
    if (!space && line.length && used + width > maxWidth) commit();
    if (space && line.length === 0) continue;
    if (!space && width > maxWidth && line.length === 0) {
      const units = graphemes(token.text);
      if (units.length > 1) {
        let chunk = "";
        for (const unit of units) {
          const trial = chunk + unit;
          if (chunk && measure(trial, token) > maxWidth) {
            line.push({ ...token, text: chunk });
            commit();
            chunk = unit;
          } else {
            chunk = trial;
          }
        }
        if (chunk) {
          line.push({ ...token, text: chunk });
          used = measure(chunk, token);
        }
        continue;
      }
      line.push(token);
      commit();
      continue;
    }
    line.push(token);
    used += width;
  }
  commit();
  return lines.map((current) => {
    const merged: TextRun[] = [];
    for (const run of current) {
      const last = merged[merged.length - 1];
      if (last && last.bold === run.bold && last.italic === run.italic) last.text += run.text;
      else merged.push({ ...run });
    }
    return merged;
  });
}

export function wrapText(text: string, maxWidth: number, measure: (text: string) => number) {
  if (!text) return [];
  return text.split("\n").flatMap((paragraph) => {
    if (!paragraph) return [""];
    const lines = wrapRuns([{ text: paragraph, bold: false, italic: false }], maxWidth, (value) => measure(value));
    const rendered = lines.map((line) => line.map((run) => run.text).join(""));
    return rendered.length ? rendered : [""];
  });
}

export function placeLines(input: {
  lines: TextRun[][];
  box: { x: number; y: number; width: number; height: number };
  align: "left" | "center" | "right";
  fontSize: number;
  extra: number;
  clip: { y: number; height: number };
  measure: (text: string, run: Pick<TextRun, "bold" | "italic">) => number;
  fallbackBold?: boolean;
  fallbackItalic?: boolean;
}): PlacedLine[] {
  const step = lineStep(input.fontSize, input.extra);
  const rise = baselineOffset(input.fontSize);
  const placed: PlacedLine[] = [];
  input.lines.forEach((runs, index) => {
    const baseline = input.box.y + index * step + rise;
    if (baseline < input.clip.y - 0.01 || baseline > input.clip.y + input.clip.height + 0.01) return;
    const widths = runs.map((run) => input.measure(run.text, run));
    const total = widths.reduce((sum, width) => sum + width, 0);
    let cursor = input.box.x;
    if (input.align === "center") cursor = input.box.x + (input.box.width - total) / 2;
    if (input.align === "right") cursor = input.box.x + input.box.width - total;
    const runPlaced: PlacedRun[] = runs.map((run, runIndex) => {
      const width = widths[runIndex] ?? 0;
      const x = cursor;
      cursor += width;
      return { ...run, x, width };
    });
    const first = runs[0];
    placed.push({
      text: runs.map((run) => run.text).join(""),
      x: runPlaced[0]?.x ?? cursor,
      baseline,
      width: total,
      fontSize: input.fontSize,
      bold: first?.bold ?? Boolean(input.fallbackBold),
      italic: first?.italic ?? Boolean(input.fallbackItalic),
      runs: runPlaced,
    });
  });
  return placed;
}

export function measureRun(text: string, run: Pick<TextRun, "bold" | "italic">, fontSize: number) {
  return measureHelvetica(text, fontSize, run.bold ? "bold" : "normal", run.italic);
}

export function plainMeasure(fontSize: number, weight: FontWeight) {
  return (text: string) => measureHelvetica(text, fontSize, weight, false);
}
