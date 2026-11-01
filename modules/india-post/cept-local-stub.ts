/** Loopback CEPT stub for Patch 1 local staging. Fake tokens only. */

export const LOCAL_CEPT_TOKEN = "LOCAL_TEST_TOKEN";
export const LOCAL_PATCH1_RUN = "LOCAL-PATCH1-20261017";

export type CeptStubResult = {
  status: number;
  body: Record<string, unknown> | string;
  delayMs?: number;
};

function loginMode(username: string, queryMode: string | null) {
  const mode = (queryMode || username || "").toLowerCase();
  if (mode.includes("timeout") || mode.includes("hang")) return "timeout";
  if (mode.includes("delay")) return "delay";
  if (mode.includes("429") || mode.includes("rate")) return "429";
  if (mode.includes("500") || mode.includes("server")) return "500";
  if (mode.includes("401") || mode.includes("unauthorized")) return "401";
  if (mode.includes("validation") || mode.includes("customer id")) return "validation";
  if (mode.includes("fail") || mode.includes("auth") || mode.includes("invalid")) return "auth";
  return "ok";
}

export function handleCeptLocalStub(
  pathname: string,
  input: { method?: string; query?: URLSearchParams; body?: Record<string, unknown>; authorization?: string }
): CeptStubResult {
  const method = (input.method || "GET").toUpperCase();
  const query = input.query ?? new URLSearchParams();
  const body = input.body ?? {};

  if (pathname === "/health") {
    return { status: 200, body: { ok: true, provider_mode: "STUB", run: LOCAL_PATCH1_RUN } };
  }

  const isLogin =
    method === "POST" &&
    (pathname === "/beextcustomer/v1/access/login" || pathname === "/v1/access/login" || pathname === "/access/login");
  if (isLogin) {
    const username = String(body.username ?? "");
    const mode = loginMode(username, query.get("mode"));
    if (mode === "timeout") return { status: 0, body: { success: false, message: "timeout" }, delayMs: 30_000 };
    if (mode === "delay") {
      return {
        status: 200,
        delayMs: Number(query.get("delay") || 50),
        body: {
          success: true,
          status_code: 200,
          data: {
            access_token: LOCAL_CEPT_TOKEN,
            refresh_token: "LOCAL_REFRESH",
            id_token: "LOCAL_ID",
            expires_in: 900,
            refresh_expires_in: 3600,
          },
        },
      };
    }
    if (mode === "429") return { status: 429, body: { success: false, message: "rate limited" } };
    if (mode === "500") return { status: 500, body: { success: false, message: "internal error" } };
    if (mode === "401") return { status: 401, body: { success: false, message: "Unauthorized" } };
    if (mode === "validation") return { status: 400, body: { success: false, message: "customer id is required" } };
    if (mode === "auth") {
      return { status: 400, body: { success: false, message: "India Post authentication failed." } };
    }
    return {
      status: 200,
      body: {
        success: true,
        status_code: 200,
        data: {
          access_token: LOCAL_CEPT_TOKEN,
          refresh_token: "LOCAL_REFRESH",
          id_token: "LOCAL_ID",
          expires_in: 900,
          refresh_expires_in: 3600,
        },
      },
    };
  }

  const isRefresh =
    method === "POST" &&
    (pathname === "/beextcustomer/v1/access/TokenWithRtoken" ||
      pathname === "/v1/access/TokenWithRtoken" ||
      pathname === "/access/TokenWithRtoken");
  if (isRefresh) {
    const auth = input.authorization || "";
    if (!auth.includes("LOCAL_REFRESH")) {
      return { status: 400, body: { success: false, error: { message: "Invalid refresh token" } } };
    }
    return {
      status: 200,
      body: {
        success: true,
        data: {
          access_token: LOCAL_CEPT_TOKEN,
          refresh_token: "LOCAL_REFRESH_ROTATED",
          id_token: "LOCAL_ID",
          expires_in: 900,
          refresh_expires_in: 3600,
        },
      },
    };
  }

  const isBulk =
    method === "POST" &&
    (pathname === "/beextcustomer/v1/tracking/bulk" ||
      pathname === "/v1/tracking/bulk" ||
      pathname === "/tracking/bulk");
  if (isBulk) {
    const mode = (query.get("mode") || "").toLowerCase();
    const auth = input.authorization || "";
    if (mode === "401" || (!auth.includes(LOCAL_CEPT_TOKEN) && mode === "require-token")) {
      return { status: 401, body: { success: false, message: "Unauthorized" } };
    }
    if (mode === "403") return { status: 403, body: { success: false, message: "You are not authorized to access this API" } };
    if (mode === "400") return { status: 400, body: { success: false, message: "article not found" } };
    if (mode === "404") return { status: 404, body: { success: false, message: "not found" } };
    if (mode === "429") return { status: 429, body: { success: false, message: "rate limited" } };
    if (mode === "500") return { status: 500, body: { success: false, message: "unavailable" } };
    if (mode === "timeout") return { status: 0, body: {}, delayMs: 30_000 };
    const bulk = Array.isArray(body.bulk) ? body.bulk.map((row) => String(row)) : [];
    if (mode === "empty") return { status: 200, body: { success: true, data: [] } };
    const articles = bulk.map((barcode, index) => {
      if (mode === "partial" && index > 0) return null;
      const delivered = mode === "delivered" || /DELIV/i.test(barcode);
      return {
        article_number: barcode,
        booking_details: { article_number: barcode },
        tracking_details:
          mode === "unknown"
            ? []
            : [
                {
                  date: "2026-10-17",
                  time: "10:00:00",
                  office: "TEST PO",
                  event: delivered ? "Item Delivered" : "Item Bagged",
                  event_code: delivered ? "ITEM_DELIVERED" : "ITEM_BAGGED",
                },
                ...(mode === "duplicate"
                  ? [
                      {
                        date: "2026-10-17",
                        time: "10:00:00",
                        office: "TEST PO",
                        event: "Item Bagged",
                        event_code: "ITEM_BAGGED",
                      },
                    ]
                  : []),
                ...(mode === "out-of-order"
                  ? [
                      {
                        date: "2026-10-16",
                        time: "09:00:00",
                        office: "OLD PO",
                        event: "Item Booked",
                        event_code: "ITEM_BOOKED",
                      },
                    ]
                  : []),
              ],
        del_status: delivered ? { del_status: "delivered" } : undefined,
      };
    });
    return { status: 200, body: { success: true, data: articles.filter(Boolean) } };
  }

  const isEventDownload =
    method === "POST" &&
    (pathname === "/beextcustomer/v1/event/download" ||
      pathname === "/v1/event/download" ||
      pathname === "/event/download");
  if (isEventDownload) {
    const mode = (query.get("mode") || "").toLowerCase();
    if (mode === "403") return { status: 403, body: { success: false, message: "You are not authorized to access this API" } };
    const article = String(body.Cust_Id ? "CX075364450IN" : "CX075364450IN");
    return {
      status: 200,
      body: `<?xml version="1.0"?><LatestEventDetails><ArticleDetails>
<ArticleNumber>${article}</ArticleNumber>
<EventCode>ITEM_DISPATCH</EventCode>
<EventDescription>Item Dispatched</EventDescription>
<EventOfficeName>TEST PO</EventOfficeName>
<EventDate>21102026</EventDate>
<EventTime>100000</EventTime>
</ArticleDetails></LatestEventDetails>`,
    };
  }

  const trackingMatch = pathname.match(/\/tracking\/([^/]+)$/);
  if (method === "GET" && trackingMatch && !pathname.endsWith("/tracking/bulk")) {
    const barcode = decodeURIComponent(trackingMatch[1] || "");
    const bulk = handleCeptLocalStub("/beextcustomer/v1/tracking/bulk", {
      method: "POST",
      query: input.query,
      body: { bulk: [barcode] },
      authorization: input.authorization,
    });
    return bulk;
  }

  if (method === "POST" && pathname === "/book") {
    return { status: 200, body: { success: true, stub: true } };
  }

  return { status: 404, body: { success: false, message: "stub route not found" } };
}
