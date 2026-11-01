import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/security/crypto";
import { IndiaPostProvider, resetIndiaPostTrackingApiForbiddenCache } from "@/modules/india-post/provider";
import { createIndiaPostLoginError, isConfirmedIndiaPostLoginAuthFailure } from "@/modules/india-post/login-auth";
import {
  classifyRequestedArticles,
  normalizeArticleNumber,
  parseBulkTrackingResponse,
} from "@/modules/india-post/tracking-response";
import { bulkEventOccurredAt } from "@/modules/india-post/apply-tracking";
import {
  planTrackingPageActions,
  trackingFailureStampsAttemptClock,
  type TrackingSyncMetadata,
} from "@/modules/india-post/tracking-outcomes";

function provider() {
  return new IndiaPostProvider({
    environment: "UAT",
    status: "CONNECTED",
    encrypted_username: encryptSecret("user"),
    encrypted_password: encryptSecret("pass"),
    bulk_customer_id: "1000002954",
  });
}

function loginThen(handler: (url: string, init?: RequestInit) => Promise<unknown> | unknown) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/access/login")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          success: true,
          data: {
            access_token: "live-token",
            refresh_token: "refresh",
            id_token: "id",
            expires_in: 3600,
            refresh_expires_in: 7200,
          },
        }),
      };
    }
    return handler(url, init);
  });
}

describe("article matching", () => {
  it("matches exact, case, and whitespace differences without using response order", () => {
    const classified = classifyRequestedArticles(
      [
        { article_number: "bb222in", tracking_details: [{ event: "Item Bagged", date: "2026-10-16", time: "11:39" }] },
        {
          article_number: "CX 075364450 IN",
          tracking_details: [{ event: "Item Dispatched", date: "2026-10-16", time: "13:18" }],
        },
      ],
      ["cx075364450in", "BB222IN"]
    );
    expect(classified.rows.map((row) => row.classification)).toEqual(["WITH_EVENTS", "WITH_EVENTS"]);
    expect(classified.articles.map((article) => normalizeArticleNumber(article.article_number))).toEqual([
      "CX075364450IN",
      "BB222IN",
    ]);
  });

  it("does not attach an unrequested or differently numbered article", () => {
    const classified = classifyRequestedArticles(
      [{ article_number: "OTHERORGIN", tracking_details: [{ event: "Item Dispatched" }] }],
      ["CX075364450IN"]
    );
    expect(classified.articles).toHaveLength(0);
    expect(classified.rows[0]?.classification).toBe("UNMATCHED");
  });

  it("rejects duplicate returned articles for the same barcode", () => {
    const classified = classifyRequestedArticles(
      [
        { article_number: "CX075364450IN", tracking_details: [{ event: "Item Booked" }] },
        { article_number: "cx075364450in", tracking_details: [{ event: "Item Dispatched" }] },
      ],
      ["CX075364450IN"]
    );
    expect(classified.rows[0]?.classification).toBe("AMBIGUOUS");
    expect(classified.articles).toHaveLength(0);
  });

  it("keeps an accepted empty history distinct from a missing article", () => {
    const empty = classifyRequestedArticles(
      [{ article_number: "CX075364450IN", tracking_details: [] }],
      ["CX075364450IN"]
    );
    expect(empty.rows[0]?.classification).toBe("EMPTY_HISTORY");
    const missing = classifyRequestedArticles([], ["CX075364450IN"]);
    expect(missing.rows[0]?.classification).toBe("UNMATCHED");
  });
});

describe("event time safety", () => {
  it("does not fabricate a timestamp when the occurrence time is missing", () => {
    expect(bulkEventOccurredAt({ event: "Item Bagged", office: "Kozhikode PH" })).toBeNull();
  });

  it("orders civil India Post timestamps as UTC instants", () => {
    const later = bulkEventOccurredAt({ date: "17/10/2026", time: "10:29" });
    const earlier = bulkEventOccurredAt({ date: "16/10/2026", time: "11:04" });
    expect(later && earlier && later > earlier).toBe(true);
  });
});

function forbiddenResponse() {
  return {
    ok: false,
    status: 403,
    headers: { get: () => null },
    json: async () => ({ success: false, error: { message: "You are not authorized to access this API" } }),
    text: async () => JSON.stringify({ success: false, error: { message: "You are not authorized to access this API" } }),
  };
}

/** TNT01/TNT02 return 403 entitlement; everything else goes to handler. */
function trackingForbiddenThen(handler: (url: string, init?: RequestInit) => Promise<unknown> | unknown) {
  return loginThen(async (url, init) => {
    if (String(url).includes("/v1/tracking/")) return forbiddenResponse();
    return handler(url, init);
  });
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const documentedArticle = (articleNumber: string) => ({
  booking_details: { article_number: articleNumber, booked_at: "Changanacherry HO" },
  tracking_details: [
    { date: "2026-09-07T12:56:46.613Z", time: "12:56:46", office: "Kalanjoor SO", event: "Taken out for delivery", rts: false },
  ],
  del_status: { del_status: "not delivered" },
});

describe("TNT01 / TNT02 tracking API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetIndiaPostTrackingApiForbiddenCache();
  });

  it("tracks one article with TNT01 GET /v1/tracking/{barcode}", async () => {
    const fetchMock = loginThen(async (url, init) => {
      expect(String(url)).toMatch(/\/v1\/tracking\/CX075364450IN$/);
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer live-token");
      return jsonResponse({ status_code: 200, success: true, data: [documentedArticle("CX075364450IN")] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await provider().trackShipment(["CX075364450IN"]);
    expect(result.tracking.providerSyncOutcome).toBe("SUCCEEDED");
    expect(result.data[0]?.tracking_details?.[0]?.event).toBe("Taken out for delivery");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/event/download"))).toBe(false);
  });

  it("accepts a TNT01 single-article data object", async () => {
    vi.stubGlobal(
      "fetch",
      loginThen(async () => jsonResponse({ success: true, data: documentedArticle("CX075364450IN") }))
    );
    const result = await provider().trackArticle("CX075364450IN");
    expect(result.data[0]?.booking_details?.article_number).toBe("CX075364450IN");
    expect(result.data[0]?.tracking_details).toHaveLength(1);
  });

  it("falls back to TNT02 when TNT01 rejects the single-article request", async () => {
    const fetchMock = loginThen(async (url, init) => {
      if (String(url).endsWith("/tracking/bulk")) {
        expect(JSON.parse(String(init?.body))).toEqual({ bulk: ["CX075364450IN"] });
        return jsonResponse({ success: true, data: [documentedArticle("CX075364450IN")] });
      }
      return { ok: false, status: 404, headers: { get: () => null }, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await provider().trackShipment(["CX075364450IN"]);
    expect(result.tracking.providerSyncOutcome).toBe("SUCCEEDED");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/event/download"))).toBe(false);
  });

  it("tracks many articles with TNT02 POST /v1/tracking/bulk in chunks of 50", async () => {
    const barcodes = Array.from({ length: 51 }, (_, index) => `CX${String(index).padStart(9, "0")}IN`);
    const bodies: string[][] = [];
    vi.stubGlobal(
      "fetch",
      loginThen(async (url, init) => {
        expect(String(url)).toMatch(/\/v1\/tracking\/bulk$/);
        expect(init?.method).toBe("POST");
        const { bulk } = JSON.parse(String(init?.body)) as { bulk: string[] };
        bodies.push(bulk);
        return jsonResponse({ success: true, data: bulk.map(documentedArticle) });
      })
    );
    const result = await provider().trackShipment(barcodes);
    expect(bodies.map((bulk) => bulk.length)).toEqual([50, 1]);
    expect(result.data).toHaveLength(51);
    expect(result.tracking.batchesSucceeded).toBe(2);
  });

  it("falls back to Event Download on 403 and skips the tracking API while the denial is cached", async () => {
    const fetchMock = trackingForbiddenThen(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => `<?xml version="1.0"?><LatestEventDetails></LatestEventDetails>`,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const tracker = provider();
    await tracker.trackShipment(["CX075364450IN"]);
    expect(tracker.trackingApiForbidden()).toBe(true);
    const trackingCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/v1/tracking/")).length;
    const before = trackingCalls();
    await tracker.trackShipment(["CX075364450IN"]);
    expect(trackingCalls()).toBe(before);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/event/download")).length).toBeGreaterThan(1);
  });

  it("treats HTTP 200 success:false 'not authorized' as a 403 entitlement denial", async () => {
    const fetchMock = loginThen(async (url) => {
      if (String(url).includes("/v1/tracking/")) {
        return jsonResponse({ success: false, error: { message: "You are not authorized to access this API" } });
      }
      return { ok: true, status: 204, headers: { get: () => null }, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await provider().trackShipment(["CX075364450IN"]);
    expect(result.tracking.providerSyncOutcome).toBe("EMPTY_ACCEPTED");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/event/download"))).toBe(true);
  });
});

describe("event download tracking outcomes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetIndiaPostTrackingApiForbiddenCache();
  });

  it("ingests XML events and does not treat empty XML as unauthorized", async () => {
    const xml = `<?xml version="1.0"?><LatestEventDetails><ArticleDetails>
<ArticleNumber>CX075364450IN</ArticleNumber>
<EventCode>ITEM_DISPATCH</EventCode>
<EventDescription>Item Dispatched</EventDescription>
<EventOfficeName>Bengaluru NSH</EventOfficeName>
<EventDate>21102026</EventDate>
<EventTime>153152</EventTime>
</ArticleDetails></LatestEventDetails>`;
    vi.stubGlobal(
      "fetch",
      trackingForbiddenThen(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => xml,
      }))
    );
    const result = await provider().trackShipment(["CX075364450IN"]);
    expect(result.tracking.providerSyncOutcome).toBe("SUCCEEDED");
    expect(result.data[0]?.tracking_details?.[0]?.event).toBe("Item Dispatched");
  });

  it("keeps an accepted empty XML distinct from a forbidden request", async () => {
    vi.stubGlobal(
      "fetch",
      trackingForbiddenThen(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => `<?xml version="1.0"?><LatestEventDetails></LatestEventDetails>`,
      }))
    );
    const result = await provider().trackShipment(["CX075364450IN"]);
    expect(result.tracking.providerSyncOutcome).toBe("EMPTY_ACCEPTED");
    expect(result.data).toEqual([]);
  });

  it("loads latest events from the event download API", async () => {
    const xml = `<?xml version="1.0"?><LatestEventDetails><ArticleDetails>
<ArticleNumber>CX075364450IN</ArticleNumber>
<EventCode>ITEM_DISPATCH</EventCode>
<EventDescription>Item Dispatched</EventDescription>
<EventOfficeName>Bengaluru NSH</EventOfficeName>
<EventDate>21102026</EventDate>
<EventTime>153152</EventTime>
</ArticleDetails></LatestEventDetails>`;
    const fetchMock = loginThen(async (url, init) => {
      if (String(url).includes("/event/download")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { Cust_Id?: string; Event_Code?: string; Event_Date?: string };
        expect(body).toMatchObject({ Cust_Id: "1000002954", Event_Code: "LE" });
        expect(body.Event_Date).toMatch(/^\d{8}$/);
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => xml,
          json: async () => ({}),
        };
      }
      return {
        ok: false,
        status: 403,
        headers: { get: () => null },
        json: async () => ({ success: false, error: { message: "You are not authorized to access this API" } }),
        text: async () => "",
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const connected = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user"),
      encrypted_password: encryptSecret("pass"),
      bulk_customer_id: "1000002954",
    });
    const result = await connected.trackShipment(["CX075364450IN"]);
    expect(result.tracking.providerSyncOutcome).toBe("SUCCEEDED");
    expect(result.data[0]?.tracking_details?.[0]?.event).toBe("Item Dispatched");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/event/download"))).toBe(true);
  });

  it("keeps the bulk 403 when event download is also forbidden", async () => {
    vi.stubGlobal(
      "fetch",
      loginThen(async () => ({
        ok: false,
        status: 403,
        headers: { get: () => null },
        json: async () => ({ success: false, error: { message: "You are not authorized to access this API" } }),
        text: async () => "",
      }))
    );
    const connected = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user"),
      encrypted_password: encryptSecret("pass"),
      bulk_customer_id: "1000002954",
    });
    const error = await connected.trackShipment(["CX075364450IN"]).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(error).toMatchObject({ status: 403, code: "HTTP_403" });
  });

  it("does not call Event Download when the customer id is not numeric", async () => {
    const fetchMock = trackingForbiddenThen(async () => {
      throw new Error("event download must not run");
    });
    vi.stubGlobal("fetch", fetchMock);
    const invalid = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: encryptSecret("user"),
      encrypted_password: encryptSecret("pass"),
      bulk_customer_id: "cust-1",
    });
    await expect(invalid.trackShipment(["CX075364450IN"])).rejects.toMatchObject({
      code: "TRACKING_CUSTOMER_ID_INVALID",
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/event/download"))).toBe(false);
  });

  it("throws a sanitized tracking 403 without marking it as a login failure", async () => {
    vi.stubGlobal(
      "fetch",
      loginThen(async () => ({
        ok: false,
        status: 403,
        headers: { get: () => null },
        json: async () => ({ success: false, error: { message: "You are not authorized to access this API" } }),
      }))
    );
    const error = await provider().trackShipment(["CX075364450IN"]).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(error).toMatchObject({ status: 403, code: "HTTP_403" });
    expect(String((error as Error).message)).not.toMatch(/authorized to access/);
    expect(isConfirmedIndiaPostLoginAuthFailure(error)).toBe(false);
    expect(trackingFailureStampsAttemptClock(error)).toBe(true);
  });

  it("does not stamp the attempt clock for login authentication failures or retryable 429s", () => {
    const login = createIndiaPostLoginError(401, "invalid credentials");
    expect(trackingFailureStampsAttemptClock(login)).toBe(false);
    expect(isConfirmedIndiaPostLoginAuthFailure(login)).toBe(true);
    expect(trackingFailureStampsAttemptClock(Object.assign(new Error("slow"), { status: 429, code: "HTTP_429" }))).toBe(
      false
    );
    expect(trackingFailureStampsAttemptClock(Object.assign(new Error("down"), { status: 503, code: "HTTP_503" }))).toBe(
      false
    );
  });
});

describe("tracking page plan", () => {
  it("stamps rejected articles and ingests only the matched article", () => {
    const tracking: TrackingSyncMetadata = {
      providerSyncOutcome: "PARTIAL",
      batchesAttempted: 1,
      batchesSucceeded: 1,
      batchesFailed: 1,
      chunkOutcomes: ["SUCCESS_WITH_PARTIAL_RESULTS"],
      articles: [
        {
          barcode: "GOODIN",
          classification: "WITH_EVENTS",
          article: {
            article_number: "GOODIN",
            tracking_details: [{ event: "Item Dispatched", date: "16/10/2026", time: "13:18:30" }],
          },
        },
        { barcode: "BADIN", classification: "REJECTED" },
      ],
    };
    const plan = planTrackingPageActions(
      [
        { id: "s1", barcode: "GOODIN" },
        { id: "s2", barcode: "BADIN" },
      ],
      tracking,
      null
    );
    expect(plan.ingest.map((item) => item.shipment.id)).toEqual(["s1"]);
    expect(plan.stampIds).toEqual(["s2"]);
    expect(plan.withEvents).toBe(1);
    expect(plan.rejected).toBe(1);
  });

  it("does not stamp retryable hard failures", () => {
    const tracking: TrackingSyncMetadata = {
      providerSyncOutcome: "REJECTED",
      batchesAttempted: 1,
      batchesSucceeded: 0,
      batchesFailed: 1,
      chunkOutcomes: ["CHUNK_HTTP_429"],
      articles: [{ barcode: "CX075364450IN", classification: "REJECTED" }],
    };
    const plan = planTrackingPageActions([{ id: "s1", barcode: "CX075364450IN" }], tracking, {
      status: 429,
      code: "HTTP_429",
    });
    expect(plan.stampIds).toEqual([]);
    expect(plan.rejected).toBe(1);
  });
});

describe("documented bulk schema still parses", () => {
  it("reads tracking_details office and event fields", () => {
    const parsed = parseBulkTrackingResponse({
      success: true,
      data: [
        {
          booking_details: { article_number: "CX075364450IN" },
          tracking_details: [{ date: "17/10/2026", time: "10:29", event: "Item Bagged", office: "Perinthalmanna SO" }],
        },
      ],
    });
    expect(parsed.data?.[0]?.tracking_details?.[0]).toMatchObject({
      event: "Item Bagged",
      office: "Perinthalmanna SO",
    });
  });
});
