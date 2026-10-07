const WIN_ANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018,
  0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

export function isWinAnsiCodePoint(cp: number) {
  if (cp >= 32 && cp <= 126) return true;
  if (cp >= 160 && cp <= 255) return true;
  return WIN_ANSI_EXTRAS.has(cp);
}

export function isWinAnsiText(value: string) {
  for (const char of value) {
    if (!isWinAnsiCodePoint(char.codePointAt(0) ?? 0)) return false;
  }
  return true;
}
