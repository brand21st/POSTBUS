import JSZip from "jszip";
import type { ValidationIssue } from "@/modules/india-post/article-types";

const ARTICLE_HEADERS: Record<string, string> = {
  "SERIAL NUMBER": "serial_number",
  "BARCODE NO": "barcode_no",
  "PHYSICAL WEIGHT": "physical_weight",
  "SHAPE OF ARTICLE": "shape_of_article",
  LENGTH: "length",
  "BREADTH/DIAMETER": "breadth_diameter",
  HEIGHT: "height",
  "PRIORITY FLAG": "priority_flag",
  "DELIVERY INSTRUCTION": "delivery_instruction",
  "INSTRUCTION RTS": "instruction_rts",
  "SENDER NAME": "sender_name",
  "SENDER COMPANY": "sender_company",
  "SENDER ADD LINE 1": "sender_add_line_1",
  "SENDER ADD LINE 2": "sender_add_line_2",
  "SENDER CITY": "sender_city",
  "SENDER STATE": "sender_state",
  "SENDER PINCODE": "sender_pincode",
  "SENDER EMAILID": "sender_emailid",
  "SENDER ALT CONTACT": "sender_alt_contact",
  "SENDER KYC": "sender_kyc",
  "SENDER TAX REFERENCE": "sender_tax_reference",
  "RECEIVER NAME": "receiver_name",
  "RECEIVER COMPANY": "receiver_company",
  "RECEIVER ADD LINE 1": "receiver_add_line_1",
  "RECEIVER ADD LINE 2": "receiver_add_line_2",
  "RECEIVER CITY": "receiver_city",
  "RECEIVER STATE": "receiver_state",
  "RECEIVER PINCODE": "receiver_pincode",
  "RECEIVER EMAILID": "receiver_emailid",
  "RECEIVER ALT CONTACT": "receiver_alt_contact",
  "RECEIVER KYC": "receiver_kyc",
  "RECEIVER TAX REFERENCE": "receiver_tax_reference",
  "ALT ADDRESS FLAG": "alt_address_flag",
  "PICKUP ADDRESS FLAG": "pickup_address_flag",
  "DROP OFF PINCODE": "drop_off_pincode",
  "DROPOFF/PICKUP OFFICE ID": "pickup_dropoff_office_id",
  "SENDER MOBILE NO": "sender_mobile_no",
  "RECEIVER MOBILE NO": "receiver_mobile_no",
  "PREPAYMENT CODE": "prepayment_code",
  "VALUE OF PREPAYMENT": "value_of_prepayment",
  "CODR/COD": "codr_cod",
  "VALUE FOR CODR/COD": "value_for_codr_cod",
  "INSURANCE TYPE": "insurance_type",
  "VALUE OF INSURANCE": "value_of_insurance",
  ACK: "ack",
  REGISTRATION: "reg",
  "OTP BASED DELIVERY": "otp",
  "BULK REFERENCE": "bulk_reference",
};

const PICKUP_HEADERS: Record<string, string> = {
  SERIAL_NO: "serial_no",
  ADDRESSEE_NAME: "addressee_name",
  COMPANY_NAME: "company_name",
  ADDRESS_LINE1: "address_line1",
  ADDRESS_LINE2: "address_line2",
  ADDRESS_LINE3: "address_line3",
  CITY: "city",
  STATE: "state",
  PINCODE: "pincode",
  EMAIL_ID: "email_id",
  ALT_CONTACT_NO: "alt_contact_no",
  MOBILE_NO: "mobile_no",
  PICKUP_SCHEDULE_SLOT: "pickup_schedule_slot",
  PICKUP_SCHEDULE_DATE: "pickup_schedule_date",
};

const ALT_HEADERS: Record<string, string> = {
  "SERIAL NO": "serial_no",
  "ADDRESSEE NAME": "addressee_name",
  "COMPANY NAME": "company_name",
  "ADDRESS LINE 1": "address_line1",
  "ADDRESS LINE 2": "address_line2",
  "ADDRESS LINE 3": "address_line3",
  CITY: "city",
  STATE: "state",
  PINCODE: "pincode",
  "EMAIL ID": "email_id",
  "ALT CONTACT NO": "alt_contact_no",
  "MOBILE NO": "mobile_no",
};

function sheetPath(target: string) {
  const cleaned = target.replace(/^\//, "").replace(/^\.\//, "");
  return cleaned.startsWith("xl/") ? cleaned : `xl/${cleaned}`;
}

function headerKey(value: string) {
  return value.replace(/\s+/g, " ").trim().toUpperCase();
}

function colRow(ref: string) {
  const match = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!match) return null;
  return { col: match[1], row: Number(match[2]) };
}

function xmlText(chunk: string) {
  return chunk
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

function parseSharedStrings(xml: string) {
  const items: string[] = [];
  const siBlocks = xml.match(/<si[\s\S]*?<\/si>/g) ?? [];
  for (const block of siBlocks) {
    const texts = [...block.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => xmlText(match[1]));
    items.push(texts.join(""));
  }
  return items;
}

function parseSheet(xml: string, shared: string[]) {
  const rows = new Map<number, Record<string, string>>();
  const cells = xml.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) ?? [];
  for (const cell of cells) {
    const ref = /r="([A-Z]+\d+)"/.exec(cell)?.[1];
    if (!ref) continue;
    const parsed = colRow(ref);
    if (!parsed) continue;
    const type = /t="([^"]+)"/.exec(cell)?.[1];
    const value = /<v>([\s\S]*?)<\/v>/.exec(cell)?.[1] ?? "";
    const inline = /<is>[\s\S]*?<\/is>/.exec(cell)?.[0] ?? "";
    let text = "";
    if (type === "s") text = shared[Number(value)] ?? "";
    else if (type === "inlineStr") text = xmlText(inline);
    else text = xmlText(value);
    const row = rows.get(parsed.row) ?? {};
    row[parsed.col] = text;
    rows.set(parsed.row, row);
  }
  return rows;
}

function columnsInOrder(row: Record<string, string>) {
  return Object.keys(row).sort((left, right) => {
    const toNum = (col: string) =>
      col.split("").reduce((total, char) => total * 26 + (char.charCodeAt(0) - 64), 0);
    return toNum(left) - toNum(right);
  });
}

function sheetRecords(rows: Map<number, Record<string, string>>, aliases: Record<string, string>) {
  const issues: ValidationIssue[] = [];
  const headerRow = rows.get(1);
  if (!headerRow) {
    return { records: [] as Array<Record<string, string>>, issues };
  }
  const cols = columnsInOrder(headerRow);
  const seen = new Map<string, string>();
  const map = new Map<string, string>();
  for (const col of cols) {
    const header = headerKey(headerRow[col] ?? "");
    if (!header) continue;
    if (seen.has(header)) {
      issues.push({
        field: header,
        value: header,
        error: "Duplicate header.",
        status: "Failed",
        category: "MAPPING",
      });
    }
    seen.set(header, col);
    const key = aliases[header] ?? aliases[header.replace(/ /g, "_")] ?? header.toLowerCase().replace(/ /g, "_");
    map.set(col, key);
  }
  const records: Array<Record<string, string>> = [];
  const maxRow = Math.max(...rows.keys());
  for (let row = 2; row <= maxRow; row += 1) {
    const cells = rows.get(row);
    if (!cells) continue;
    const record: Record<string, string> = {};
    let any = false;
    for (const col of cols) {
      const key = map.get(col);
      if (!key) continue;
      const value = (cells[col] ?? "").trim();
      record[key] = value;
      if (value) any = true;
    }
    if (any) records.push(record);
  }
  return { records, issues };
}

export function excelSerialToPickupDate(value: string) {
  const trimmed = value.trim();
  if (/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2} (AM|PM)$/.test(trimmed)) return trimmed;
  const serial = Number(trimmed);
  if (!Number.isFinite(serial) || serial <= 0) return trimmed;
  const utc = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  const date = new Date(utc);
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  return `${mm}/${dd}/${yyyy} 10:00:00 AM`;
}

export type ParsedExcelBooking = {
  articles: Array<Record<string, string>>;
  pickups: Map<string, Record<string, string>>;
  alts: Map<string, Record<string, string>>;
  issues: ValidationIssue[];
};

export async function parseIndiaPostBookingWorkbook(bytes: ArrayBuffer | Uint8Array): Promise<ParsedExcelBooking> {
  const zip = await JSZip.loadAsync(bytes);
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  const sharedXml = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  if (!workbookXml || !relsXml) {
    return {
      articles: [],
      pickups: new Map(),
      alts: new Map(),
      issues: [
        {
          field: "workbook",
          value: "",
          error: "The file is not a valid India Post Excel workbook.",
          status: "Failed",
          category: "MAPPING",
        },
      ],
    };
  }
  const shared = parseSharedStrings(sharedXml);
  const ridToTarget = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    const id = /Id="([^"]+)"/.exec(tag)?.[1];
    const target = /Target="([^"]+)"/.exec(tag)?.[1];
    if (id && target) ridToTarget.set(id, sheetPath(target));
  }
  const sheets = new Map<string, string>();
  for (const match of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const tag = match[0];
    const name = /name="([^"]+)"/.exec(tag)?.[1];
    const rid = /r:id="([^"]+)"/.exec(tag)?.[1];
    if (name && rid) sheets.set(name, ridToTarget.get(rid) ?? "");
  }
  const issues: ValidationIssue[] = [];
  for (const name of ["ArticleDetails", "PickupAddress", "AltAddress", "Information"]) {
    if (!sheets.has(name)) {
      issues.push({
        field: name,
        value: "",
        error: `Sheet ${name} is required.`,
        status: "Failed",
        category: "MAPPING",
      });
    }
  }

  async function load(name: string, aliases: Record<string, string>) {
    const target = sheets.get(name);
    if (!target) return [] as Array<Record<string, string>>;
    const file = zip.file(target) ?? zip.file(target.replace(/^xl\//, ""));
    if (!file) return [];
    const xml = await file.async("string");
    const parsed = sheetRecords(parseSheet(xml, shared), aliases);
    issues.push(...parsed.issues);
    return parsed.records;
  }

  const articles = await load("ArticleDetails", ARTICLE_HEADERS);
  const pickupRows = await load("PickupAddress", PICKUP_HEADERS);
  const altRows = await load("AltAddress", ALT_HEADERS);
  const pickups = new Map<string, Record<string, string>>();
  for (const row of pickupRows) {
    const serial = (row.serial_no || "").trim();
    if (serial) pickups.set(serial, { ...row, pickup_schedule_date: excelSerialToPickupDate(row.pickup_schedule_date || "") });
  }
  const alts = new Map<string, Record<string, string>>();
  for (const row of altRows) {
    const serial = (row.serial_no || "").trim();
    if (serial) alts.set(serial, row);
  }
  return { articles, pickups, alts, issues };
}
