import { measureHelvetica } from "@/modules/labels/layout/measure";
import { lineStep, wrapRuns } from "@/modules/labels/layout/text";
import { ptFromMm } from "@/modules/labels/layout/units";

export { ptFromMm as mmToPt } from "@/modules/labels/layout/units";

export const ADDRESS_FIELD_IDS = [
  "name",
  "street",
  "city",
  "district",
  "state",
  "pincode",
  "country",
  "mobile",
  "altMobile",
  "email",
] as const;

export type AddressFieldId = (typeof ADDRESS_FIELD_IDS)[number];

export type AddressFieldConfig = {
  id: AddressFieldId;
  visible: boolean;
  sameLineAsNext?: boolean;
  bold?: boolean;
  italic?: boolean;
};

export type AddressLayout = {
  showHeading: boolean;
  headingText: string;
  headingBold: boolean;
  headingItalic: boolean;
  lineGapMm: number;
  separatorThicknessMm: number;
  sameLineSeparator: string;
  fields: AddressFieldConfig[];
};

export type AddressParts = {
  name?: string;
  street?: string;
  city?: string;
  district?: string;
  state?: string;
  pincode?: string;
  country?: string;
  mobile?: string;
  altMobile?: string;
  email?: string;
};

export type AddressRun = { text: string; bold: boolean; italic: boolean };

const FIELD_META: Array<{
  id: AddressFieldId;
  label: string;
  defaultOn: boolean;
  defaultSameLine: boolean;
}> = [
  { id: "name", label: "Name", defaultOn: true, defaultSameLine: false },
  { id: "street", label: "Street / full address", defaultOn: true, defaultSameLine: false },
  { id: "city", label: "City", defaultOn: true, defaultSameLine: true },
  { id: "district", label: "District", defaultOn: false, defaultSameLine: false },
  { id: "state", label: "State", defaultOn: true, defaultSameLine: false },
  { id: "pincode", label: "Pincode", defaultOn: true, defaultSameLine: true },
  { id: "country", label: "Country", defaultOn: true, defaultSameLine: true },
  { id: "mobile", label: "Mobile number", defaultOn: true, defaultSameLine: false },
  { id: "altMobile", label: "Alternate mobile", defaultOn: false, defaultSameLine: false },
  { id: "email", label: "Email", defaultOn: false, defaultSameLine: false },
];

export const ADDRESS_FIELD_OPTIONS = FIELD_META.map(({ id, label }) => ({ id, label }));

export const SAMPLE_SHIP_PARTS: AddressParts = {
  name: "Priya Nair",
  street: "14 Lake View",
  city: "Ernakulam",
  state: "Kerala",
  pincode: "682016",
  country: "India",
  mobile: "9876501234",
};

function defaultField(meta: (typeof FIELD_META)[number]): AddressFieldConfig {
  return {
    id: meta.id,
    visible: meta.defaultOn,
    sameLineAsNext: meta.defaultSameLine,
    bold: false,
    italic: false,
  };
}

export function defaultAddressLayout(headingText = "Ship To:"): AddressLayout {
  return {
    showHeading: true,
    headingText,
    headingBold: true,
    headingItalic: false,
    lineGapMm: 5.5,
    separatorThicknessMm: 0,
    sameLineSeparator: ",",
    fields: FIELD_META.map(defaultField),
  };
}

export function normalizeAddressLayout(layout?: Partial<AddressLayout> | null, headingText = "Ship To:"): AddressLayout {
  const base = defaultAddressLayout(headingText);
  const incoming = new Map((layout?.fields ?? []).map((field) => [field.id, field]));
  return {
    showHeading: layout?.showHeading ?? base.showHeading,
    headingText: layout?.headingText?.trim() ? layout.headingText : base.headingText,
    headingBold: layout?.headingBold ?? base.headingBold,
    headingItalic: layout?.headingItalic ?? base.headingItalic,
    lineGapMm: Number.isFinite(layout?.lineGapMm) ? Number(layout?.lineGapMm) : base.lineGapMm,
    separatorThicknessMm: 0,
    sameLineSeparator: layout?.sameLineSeparator ?? base.sameLineSeparator,
    fields: FIELD_META.map((meta) => {
      const saved = incoming.get(meta.id);
      return saved
        ? {
            id: meta.id,
            visible: saved.visible !== false,
            sameLineAsNext: Boolean(saved.sameLineAsNext),
            bold: Boolean(saved.bold),
            italic: Boolean(saved.italic),
          }
        : defaultField(meta);
    }).sort((a, b) => {
      const saved = layout?.fields?.map((field) => field.id) ?? [];
      const ai = saved.indexOf(a.id);
      const bi = saved.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }),
  };
}

export function addressPartsFromParty(party: {
  name?: string;
  phone?: string;
  lines?: string[];
  street?: string;
  city?: string;
  district?: string;
  state?: string;
  pincode?: string;
  country?: string;
  altMobile?: string;
  email?: string;
}): AddressParts {
  return {
    name: party.name?.trim() || "",
    street: party.street?.trim() || "",
    city: party.city?.trim() || "",
    district: party.district?.trim() || "",
    state: party.state?.trim() || "",
    pincode: party.pincode?.trim() || "",
    country: party.country?.trim() || "",
    mobile: party.phone?.trim() || "",
    altMobile: party.altMobile?.trim() || "",
    email: party.email?.trim() || "",
  };
}

function fieldValue(id: AddressFieldId, parts: AddressParts) {
  if (id === "mobile") {
    const mobile = (parts.mobile ?? "").trim();
    return mobile ? `Mobile: ${mobile}` : "";
  }
  if (id === "altMobile") {
    const mobile = (parts.altMobile ?? "").trim();
    return mobile ? `Alt: ${mobile}` : "";
  }
  return (parts[id] ?? "").trim();
}

export function composeAddressLines(
  layoutInput: Partial<AddressLayout> | null | undefined,
  parts: AddressParts,
  headingText = "Ship To:"
) {
  const layout = normalizeAddressLayout(layoutInput, headingText);
  const separator = layout.sameLineSeparator.trim() ? `${layout.sameLineSeparator.trim()} ` : " ";
  const lines: AddressRun[][] = [];
  let current: AddressRun[] = [];
  const visible = layout.fields.filter((field) => field.visible);

  visible.forEach((field, index) => {
    const value = fieldValue(field.id, parts);
    if (value) {
      if (current.length) current.push({ text: separator, bold: false, italic: false });
      current.push({ text: value, bold: Boolean(field.bold), italic: Boolean(field.italic) });
    }
    const next = visible[index + 1];
    const nextValue = next ? fieldValue(next.id, parts) : "";
    if (!field.sameLineAsNext || !next || !nextValue) {
      if (current.length) lines.push(current);
      current = [];
    }
  });
  if (current.length) lines.push(current);

  const heading =
    layout.showHeading && layout.headingText.trim()
      ? { text: layout.headingText.trim(), bold: layout.headingBold, italic: layout.headingItalic }
      : null;
  return { heading, lines, layout };
}

export function addressLineTexts(layout: Partial<AddressLayout> | null | undefined, parts: AddressParts) {
  const composed = composeAddressLines(layout, parts);
  const rows = composed.lines.map((runs) => runs.map((run) => run.text).join(""));
  if (composed.heading) return [composed.heading.text, ...rows];
  return rows;
}

const HELVETICA_UNITS: Record<string, number> = {
  " ": 278,
  ".": 278,
  ",": 278,
  ":": 278,
  ";": 278,
  i: 278,
  l: 278,
  I: 278,
  j: 278,
  t: 333,
  f: 333,
  r: 333,
  s: 500,
};

export function helveticaTextWidth(text: string, fontSize: number, bold = false) {
  const scale = ((bold ? 1.08 : 1) * fontSize) / 1000;
  let width = 0;
  for (const char of text) width += HELVETICA_UNITS[char] ?? HELVETICA_UNITS[char.toLowerCase()] ?? 556;
  return width * scale;
}

export function wrapAddressRuns(
  runs: AddressRun[],
  maxWidth: number,
  measure: (text: string, run: Pick<AddressRun, "bold" | "italic">) => number
): AddressRun[][] {
  if (maxWidth <= 0) return runs.length ? [runs] : [];
  const tokens: AddressRun[] = [];
  for (const run of runs) {
    for (const part of run.text.split(/(\s+)/).filter((part) => part.length > 0)) {
      tokens.push({ text: part, bold: run.bold, italic: run.italic });
    }
  }
  const lines: AddressRun[][] = [];
  let line: AddressRun[] = [];
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
      line.push(token);
      commit();
      continue;
    }
    line.push(token);
    used += width;
  }
  commit();
  return lines.map((line) => {
    const merged: AddressRun[] = [];
    for (const run of line) {
      const last = merged[merged.length - 1];
      if (last && last.bold === run.bold && last.italic === run.italic) last.text += run.text;
      else merged.push({ ...run });
    }
    return merged;
  });
}

export const SAMPLE_FROM_PARTS: AddressParts = {
  name: "Sample Store",
  street: "12 Market Road",
  city: "Kochi",
  state: "Kerala",
  pincode: "682311",
  country: "India",
  mobile: "9876543210",
};

export function addressContentHeight(
  element: { width: number; fontSize?: number; lineGap?: number; gap?: number; addressLayout?: Partial<AddressLayout> | null },
  parts: AddressParts,
  headingText = "Ship To:"
) {
  const composed = composeAddressLines(element.addressLayout, parts, headingText);
  const gap = element.gap ?? 0;
  const inner = Math.max(0, element.width - gap * 2);
  const size = element.fontSize ?? 9;
  const measure = (text: string, run: Pick<AddressRun, "bold" | "italic">) =>
    measureHelvetica(text, size, run.bold ? "bold" : "normal", run.italic);
  const headingLines = composed.heading ? wrapRuns([composed.heading], inner, measure) : [];
  const body = composed.lines.flatMap((line) => wrapRuns(line, inner, measure));
  return gap * 2 + (headingLines.length + body.length) * lineStep(size, ptFromMm(composed.layout.lineGapMm));
}
