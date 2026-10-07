export type PaintScript =
  | "latin"
  | "devanagari"
  | "bengali"
  | "gurmukhi"
  | "gujarati"
  | "oriya"
  | "tamil"
  | "telugu"
  | "kannada"
  | "malayalam"
  | "common";

export type ScriptRun = {
  text: string;
  script: Exclude<PaintScript, "common">;
};

const BIDI_CONTROLS = new Set([
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
]);

export function sanitizeLabelText(value: string) {
  const normalized = String(value ?? "").normalize("NFC");
  let output = "";
  for (const char of normalized) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp === 0x200c || cp === 0x200d) {
      output += char;
      continue;
    }
    if (cp === 9 || cp === 10 || cp === 13) {
      output += " ";
      continue;
    }
    if (cp < 32 || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f) || BIDI_CONTROLS.has(cp)) continue;
    output += char;
  }
  return output;
}

export function scriptOfCodePoint(cp: number): PaintScript {
  if (cp === 0x200c || cp === 0x200d) return "common";
  if (cp >= 0x0900 && cp <= 0x097f) return "devanagari";
  if (cp >= 0x0980 && cp <= 0x09ff) return "bengali";
  if (cp >= 0x0a00 && cp <= 0x0a7f) return "gurmukhi";
  if (cp >= 0x0a80 && cp <= 0x0aff) return "gujarati";
  if (cp >= 0x0b00 && cp <= 0x0b7f) return "oriya";
  if (cp >= 0x0b80 && cp <= 0x0bff) return "tamil";
  if (cp >= 0x0c00 && cp <= 0x0c7f) return "telugu";
  if (cp >= 0x0c80 && cp <= 0x0cff) return "kannada";
  if (cp >= 0x0d00 && cp <= 0x0d7f) return "malayalam";
  if ((cp >= 0x0300 && cp <= 0x036f) || (cp >= 0xfe00 && cp <= 0xfe0f)) return "common";
  return "latin";
}

export function segmentScriptRuns(value: string): ScriptRun[] {
  const text = sanitizeLabelText(value);
  if (!text) return [];
  const runs: ScriptRun[] = [];
  let currentScript: Exclude<PaintScript, "common"> = "latin";
  let buffer = "";
  const flush = () => {
    if (!buffer) return;
    runs.push({ text: buffer, script: currentScript });
    buffer = "";
  };
  let started = false;
  for (const char of text) {
    const classified = scriptOfCodePoint(char.codePointAt(0) ?? 0);
    if (!started) {
      currentScript = classified === "common" ? "latin" : classified;
      buffer = char;
      started = true;
      continue;
    }
    if (classified === "common" || classified === currentScript) {
      buffer += char;
      continue;
    }
    flush();
    currentScript = classified;
    buffer = char;
  }
  flush();
  return runs;
}

export function graphemes(value: string) {
  const text = sanitizeLabelText(value);
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)].map((part) => part.segment);
  }
  return [...text];
}
