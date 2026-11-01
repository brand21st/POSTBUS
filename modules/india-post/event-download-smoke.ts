import { parseIndiaPostEventDownloadBody } from "@/modules/india-post/event-download";
import { bulkArticleNumber, normalizeArticleNumber } from "@/modules/india-post/tracking-response";

export type EventDownloadSmokeVerdict =
  | "PASS"
  | "PARTIAL"
  | "INCONCLUSIVE"
  | "BLOCKED"
  | "FAIL"
  | "UNAVAILABLE";

export type EventDownloadSmokeReport = {
  verdict: EventDownloadSmokeVerdict;
  httpStatus: number | null;
  contentType: string | null;
  xmlValid: boolean | null;
  articleCount: number;
  knownAwbPresent: boolean | null;
  eventDatesValid: boolean | null;
  descriptionsParsed: boolean | null;
  emptyNoContent: boolean;
  reason: string;
};

const DATE_OK = /^\d{2}\/\d{2}\/\d{4}$/;

export function classifyEventDownloadSmoke(input: {
  httpStatus: number;
  contentType?: string | null;
  body?: string;
  knownAwb?: string | null;
}): EventDownloadSmokeReport {
  const httpStatus = input.httpStatus;
  const contentType = input.contentType ?? null;
  const body = input.body ?? "";
  const knownAwb = normalizeArticleNumber(input.knownAwb);

  if (httpStatus === 403) {
    return {
      verdict: "BLOCKED",
      httpStatus,
      contentType,
      xmlValid: null,
      articleCount: 0,
      knownAwbPresent: null,
      eventDatesValid: null,
      descriptionsParsed: null,
      emptyNoContent: false,
      reason: "CEPT authorization required. Stop rollout.",
    };
  }
  if (httpStatus === 401) {
    return {
      verdict: "FAIL",
      httpStatus,
      contentType,
      xmlValid: null,
      articleCount: 0,
      knownAwbPresent: null,
      eventDatesValid: null,
      descriptionsParsed: null,
      emptyNoContent: false,
      reason: "Authentication investigation required.",
    };
  }
  if (httpStatus >= 500) {
    return {
      verdict: "UNAVAILABLE",
      httpStatus,
      contentType,
      xmlValid: null,
      articleCount: 0,
      knownAwbPresent: null,
      eventDatesValid: null,
      descriptionsParsed: null,
      emptyNoContent: false,
      reason: "Provider unavailable.",
    };
  }
  if (httpStatus === 204 || !body.trim()) {
    return {
      verdict: "INCONCLUSIVE",
      httpStatus,
      contentType,
      xmlValid: httpStatus === 204 ? null : false,
      articleCount: 0,
      knownAwbPresent: false,
      eventDatesValid: null,
      descriptionsParsed: null,
      emptyNoContent: true,
      reason: "Empty response. Do not claim tracking success.",
    };
  }

  let articles;
  try {
    articles = parseIndiaPostEventDownloadBody(body);
  } catch {
    return {
      verdict: "FAIL",
      httpStatus,
      contentType,
      xmlValid: false,
      articleCount: 0,
      knownAwbPresent: false,
      eventDatesValid: null,
      descriptionsParsed: false,
      emptyNoContent: false,
      reason: "Response contract investigation required (invalid XML).",
    };
  }

  const eventDatesValid = articles.every((article) =>
    (article.tracking_details ?? []).every((event) => !event.date || DATE_OK.test(String(event.date)))
  );
  const descriptionsParsed = articles.some((article) =>
    (article.tracking_details ?? []).some((event) => Boolean(event.event || event.event_code))
  );
  const knownAwbPresent = knownAwb
    ? articles.some((article) => normalizeArticleNumber(bulkArticleNumber(article)) === knownAwb)
    : null;

  if (httpStatus === 200 && articles.length >= 0) {
    if (knownAwb && knownAwbPresent) {
      return {
        verdict: "PASS",
        httpStatus,
        contentType,
        xmlValid: true,
        articleCount: articles.length,
        knownAwbPresent: true,
        eventDatesValid,
        descriptionsParsed,
        emptyNoContent: false,
        reason: "Read-only provider and AWB matching verified.",
      };
    }
    return {
      verdict: "PARTIAL",
      httpStatus,
      contentType,
      xmlValid: true,
      articleCount: articles.length,
      knownAwbPresent: knownAwb ? false : null,
      eventDatesValid,
      descriptionsParsed,
      emptyNoContent: false,
      reason: "Provider returned valid XML. Known AWB was not in this Event_Date feed.",
    };
  }

  return {
    verdict: "FAIL",
    httpStatus,
    contentType,
    xmlValid: true,
    articleCount: articles.length,
    knownAwbPresent: knownAwbPresent,
    eventDatesValid,
    descriptionsParsed,
    emptyNoContent: false,
    reason: `Unexpected HTTP ${httpStatus}.`,
  };
}
