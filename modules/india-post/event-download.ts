import type { BulkTrackingArticle, BulkTrackingEvent } from "@/modules/india-post/apply-tracking";
import { bulkEventOccurredAt } from "@/modules/india-post/apply-tracking";
import { INDIA_POST_EVENT_DOWNLOAD_MAX_BYTES } from "@/modules/india-post/spec";
import { bulkArticleNumber, normalizeArticleNumber } from "@/modules/india-post/tracking-response";

/** Cust_Id is a 10-digit string. Mixed values such as "cust-1" are not sent. */
export function indiaPostEventCustomerId(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,10}$/.test(text)) return null;
  return text.padStart(10, "0");
}

/** Event_Date values, today first, in Asia/Kolkata as DDMMYYYY. */
export function indiaPostEventDates(days: number, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const count = Math.max(0, Math.floor(days));
  const dates: string[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const date = new Date(Date.UTC(year, month - 1, day - offset));
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = String(date.getUTCFullYear());
    dates.push(`${dd}${mm}${yyyy}`);
  }
  return dates;
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function xmlTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function eventClock(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 6) return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}`;
  if (digits.length === 4) return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:00`;
  return value.trim();
}

function eventDay(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 8) return value.trim();
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function articleFromBlock(block: string): BulkTrackingArticle | null {
  const articleNumber = xmlTag(block, "ArticleNumber");
  const description = xmlTag(block, "EventDescription");
  const code = xmlTag(block, "EventCode");
  if (!articleNumber && !description && !code) return null;
  const event: BulkTrackingEvent = {
    date: eventDay(xmlTag(block, "EventDate")),
    time: eventClock(xmlTag(block, "EventTime")),
    office: xmlTag(block, "EventOfficeName"),
    officeid: xmlTag(block, "EventOfficeFaciltyID") || xmlTag(block, "EventOfficeFacilityID"),
    event: description || code,
    event_code: code,
    remarks: xmlTag(block, "NonDelReason"),
  };
  const delivered = /deliver/i.test(description);
  return {
    article_number: articleNumber,
    booking_details: {
      article_number: articleNumber,
      ...(delivered ? { delivery_confirmed_on: event.date } : {}),
    },
    tracking_details: [event],
    ...(delivered ? { del_status: { del_status: "delivered" } } : {}),
  };
}

export function indiaPostEventDownloadParseError(message: string) {
  const error = new Error(message);
  (error as { status?: number; code?: string }).status = 502;
  (error as { status?: number; code?: string }).code = "TEMPORARY_PROVIDER_FAILURE";
  return error;
}

/** Reject oversized XML and DTD/entity payloads. Regex parsing does not expand entities. */
export function assertSafeIndiaPostEventXml(xml: string) {
  if (xml.length > INDIA_POST_EVENT_DOWNLOAD_MAX_BYTES) {
    throw indiaPostEventDownloadParseError("India Post event download exceeded the size limit.");
  }
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw indiaPostEventDownloadParseError("India Post event download XML was rejected.");
  }
}

/** Latest-event XML from POST /v1/event/download. */
export function parseIndiaPostEventDownloadXml(xml: string): BulkTrackingArticle[] {
  assertSafeIndiaPostEventXml(xml);
  const articles: BulkTrackingArticle[] = [];
  for (const match of xml.matchAll(/<ArticleDetails>([\s\S]*?)<\/ArticleDetails>/gi)) {
    const article = articleFromBlock(match[1] ?? "");
    if (article) articles.push(article);
  }
  return articles;
}

export function parseIndiaPostEventDownloadBody(text: string): BulkTrackingArticle[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("<")) return parseIndiaPostEventDownloadXml(trimmed);
  throw indiaPostEventDownloadParseError("India Post event download did not return XML.");
}

function eventKey(articleNumber: string, event: BulkTrackingEvent) {
  return [
    articleNumber,
    event.event_code ?? "",
    event.event ?? "",
    event.date ?? "",
    event.time ?? "",
    event.office ?? "",
  ].join("|");
}

/** One article per barcode, with scans from several event-download days. */
export function mergeEventDownloadArticles(articles: BulkTrackingArticle[]): BulkTrackingArticle[] {
  const grouped = new Map<string, BulkTrackingArticle>();
  for (const article of articles) {
    const number = bulkArticleNumber(article);
    const key = normalizeArticleNumber(number);
    if (!key) continue;
    const existing = grouped.get(key);
    const incoming = article.tracking_details ?? [];
    if (!existing) {
      grouped.set(key, {
        ...article,
        article_number: number,
        tracking_details: [...incoming],
      });
      continue;
    }
    const seen = new Set((existing.tracking_details ?? []).map((event) => eventKey(key, event)));
    for (const event of incoming) {
      const id = eventKey(key, event);
      if (seen.has(id)) continue;
      seen.add(id);
      existing.tracking_details = [...(existing.tracking_details ?? []), event];
    }
    if (article.del_status?.del_status) existing.del_status = article.del_status;
  }
  for (const article of grouped.values()) {
    article.tracking_details = [...(article.tracking_details ?? [])].sort((left, right) => {
      const leftAt = bulkEventOccurredAt(left);
      const rightAt = bulkEventOccurredAt(right);
      if (leftAt && rightAt) return leftAt < rightAt ? -1 : leftAt > rightAt ? 1 : 0;
      return 0;
    });
  }
  return [...grouped.values()];
}
