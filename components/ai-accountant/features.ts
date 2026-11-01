import {
  BookOpenCheck,
  FileSpreadsheet,
  LayoutDashboard,
  type LucideIcon,
  Landmark,
  PieChart,
  Receipt,
  Settings2,
  Sparkles,
  Truck,
} from "lucide-react";

/** Single source for nav, the feature guide and the overview hub. */
export type FeatureKey = "overview" | "assistant" | "reports" | "ledger" | "expenses" | "gst" | "cod" | "exports" | "settings";

export type Feature = {
  key: FeatureKey;
  href: string;
  label: string;
  icon: LucideIcon;
  group: "Start" | "Books" | "Tax & COD" | "Data & setup";
  summary: string;
  /** What a merchant can do here, in plain words. */
  actions: string[];
  /** Where the settings that affect this feature live. */
  configuredIn?: string;
};

const BASE = "/dashboard/ai-accountant";

export const FEATURES: Feature[] = [
  {
    key: "overview",
    href: BASE,
    label: "Overview",
    icon: LayoutDashboard,
    group: "Start",
    summary: "This month at a glance, setup progress and shortcuts to every tool.",
    actions: ["See revenue, profit, COD and GST for this month", "Finish setup steps", "Sync orders and postage into the books"],
  },
  {
    key: "assistant",
    href: `${BASE}/assistant`,
    label: "Ask AI",
    icon: Sparkles,
    group: "Start",
    summary: "Ask questions about your books in plain language. Answers use only your PostBus data.",
    actions: ["“What was my profit last month?”", "“How much GST do I owe?”", "“Which COD payments are pending?”"],
    configuredIn: "Settings → AI assistant (quota and reset date)",
  },
  {
    key: "reports",
    href: `${BASE}/reports`,
    label: "Reports",
    icon: PieChart,
    group: "Books",
    summary: "Profit & loss, cash flow and balance sheet for any period.",
    actions: ["Compare months and financial years", "Download for your CA (Excel or CSV)"],
    configuredIn: "Settings → Financial year & books",
  },
  {
    key: "ledger",
    href: `${BASE}/ledger`,
    label: "Ledger",
    icon: BookOpenCheck,
    group: "Books",
    summary: "Every entry in your books, the trial balance and manual adjustments.",
    actions: ["Add opening balances or owner capital", "Reverse a wrong entry", "Export to Tally Prime"],
    configuredIn: "Settings → Financial year & books (books start date)",
  },
  {
    key: "expenses",
    href: `${BASE}/expenses`,
    label: "Expenses",
    icon: Receipt,
    group: "Books",
    summary: "Record expenses and supplier invoices, attach receipts and track GST input credit.",
    actions: ["Add rent, ads, packaging and other costs", "Record stock purchases with GST", "Attach bills and receipts"],
  },
  {
    key: "gst",
    href: `${BASE}/gst`,
    label: "GST",
    icon: Landmark,
    group: "Tax & COD",
    summary: "Set HSN, GST rate and cost per product, and prepare GSTR-1 and GSTR-3B drafts.",
    actions: ["Fill product HSN, rate and unit cost", "Prepare monthly return drafts for your CA"],
    configuredIn: "Settings → Business & GST and Tax defaults",
  },
  {
    key: "cod",
    href: `${BASE}/cod`,
    label: "COD",
    icon: Truck,
    group: "Tax & COD",
    summary: "Upload India Post COD remittance reports and match them to your shipments.",
    actions: ["Upload Excel, CSV or PDF reports", "Resolve short or missing payments"],
  },
  {
    key: "exports",
    href: `${BASE}/exports`,
    label: "Exports",
    icon: FileSpreadsheet,
    group: "Data & setup",
    summary: "Download reports, GST drafts, expenses and Tally files.",
    actions: ["Excel and CSV for your CA", "Tally Prime XML import"],
  },
  {
    key: "settings",
    href: `${BASE}/settings`,
    label: "Settings",
    icon: Settings2,
    group: "Data & setup",
    summary: "GST registration, tax defaults, financial year, automation, AI quota and access.",
    actions: ["Add your GSTIN", "Choose a default GST rate", "Set your financial year and books start date"],
  },
];

export const FEATURE_GROUPS = ["Start", "Books", "Tax & COD", "Data & setup"] as const;

export function featureFor(pathname: string | null) {
  if (!pathname) return FEATURES[0]!;
  return [...FEATURES].reverse().find((f) => (f.key === "overview" ? pathname === f.href : pathname.startsWith(f.href))) ?? FEATURES[0]!;
}

export const SETUP_STEP_COPY: Record<string, { title: string; why: string; href: string; cta: string }> = {
  gst: {
    title: "Confirm GST registration",
    why: "Decides whether sales carry GST and whether you can claim input credit.",
    href: `${BASE}/settings#gst`,
    cta: "Open settings",
  },
  tax_rates: {
    title: "Give products a GST rate",
    why: "Needed for GST drafts. Set a default rate or a rate per product.",
    href: `${BASE}/gst#products`,
    cta: "Set rates",
  },
  costs: {
    title: "Add product costs or purchases",
    why: "Without costs, profit is shown as not verified.",
    href: `${BASE}/gst#products`,
    cta: "Add costs",
  },
  sync: {
    title: "Sync orders and postage into the books",
    why: "Brings booked shipments, RTOs, COD and PostBus fees into your ledger. Runs daily after the first sync.",
    href: BASE,
    cta: "Sync now",
  },
  cod: {
    title: "Clear the COD review queue",
    why: "Short, missing or duplicate India Post remittances need a decision.",
    href: `${BASE}/cod`,
    cta: "Review COD",
  },
};

export const GLOSSARY: Array<{ term: string; meaning: string }> = [
  { term: "Input tax credit (ITC)", meaning: "GST you paid on business purchases that you can subtract from GST you collected." },
  { term: "GSTR-1", meaning: "Monthly return listing your sales invoices. PostBus prepares a draft; you or your CA file it." },
  { term: "GSTR-3B", meaning: "Monthly summary of GST collected, credit claimed and tax payable." },
  { term: "COGS", meaning: "Cost of goods sold: what the products you shipped cost you." },
  { term: "RTO", meaning: "Return to origin. The sale is reversed in your books when India Post returns the parcel." },
  { term: "Reversal", meaning: "Posted entries are never edited. A mirror entry cancels a wrong one so history stays intact." },
];
