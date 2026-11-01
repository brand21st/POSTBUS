import { describe, expect, it } from "vitest";
import {
  indiaPostEventCustomerId,
  indiaPostEventDates,
  mergeEventDownloadArticles,
  parseIndiaPostEventDownloadBody,
  parseIndiaPostEventDownloadXml,
} from "@/modules/india-post/event-download";

const SAMPLE = `<?xml version="1.0" encoding="utf-8"?><LatestEventDetails>
<ArticleDetails>
<ArticleNumber>CX075364450IN</ArticleNumber>
<EventCode>ITEM_DISPATCH</EventCode>
<EventDescription>Item Dispatched</EventDescription>
<EventOfficeFaciltyID>SP21150000650</EventOfficeFaciltyID>
<EventOfficeName>Bengaluru NSH</EventOfficeName>
<EventDate>21102026</EventDate>
<EventTime>153152</EventTime>
<NonDelReason></NonDelReason>
</ArticleDetails>
<ArticleDetails>
<ArticleNumber>EM295811157IN</ArticleNumber>
<EventCode>ITEM_DELIVERY</EventCode>
<EventDescription>Item Delivered</EventDescription>
<EventOfficeName>Basti Jodhewal SO</EventOfficeName>
<EventDate>21102026</EventDate>
<EventTime>160000</EventTime>
<NonDelReason></NonDelReason>
</ArticleDetails>
</LatestEventDetails>`;

describe("India Post event download", () => {
  it("requires a numeric customer id of at most 10 digits", () => {
    expect(indiaPostEventCustomerId("cust-1")).toBeNull();
    expect(indiaPostEventCustomerId("1000002954")).toBe("1000002954");
    expect(indiaPostEventCustomerId("2954")).toBe("0000002954");
    expect(indiaPostEventCustomerId("12345678901")).toBeNull();
    expect(indiaPostEventCustomerId("1000002954 ")).toBe("1000002954");
  });

  it("formats event dates as DDMMYYYY starting today in India", () => {
    const dates = indiaPostEventDates(2, new Date("2026-10-21T12:00:00.000Z"));
    expect(dates).toEqual(["21102026", "20102026"]);
  });

  it("maps latest-event XML into bulk tracking articles", () => {
    const articles = parseIndiaPostEventDownloadXml(SAMPLE);
    expect(articles).toHaveLength(2);
    expect(articles[0]).toMatchObject({
      article_number: "CX075364450IN",
      tracking_details: [
        {
          date: "21/10/2026",
          time: "15:31:52",
          office: "Bengaluru NSH",
          event: "Item Dispatched",
          event_code: "ITEM_DISPATCH",
        },
      ],
    });
    expect(articles[1]?.del_status?.del_status).toBe("delivered");
  });

  it("treats an empty or HTTP 204 body as no events, not as a parse success for shipment updates", () => {
    expect(parseIndiaPostEventDownloadBody("")).toEqual([]);
    expect(parseIndiaPostEventDownloadBody("   ")).toEqual([]);
  });

  it("rejects DTD and oversized XML", () => {
    expect(() =>
      parseIndiaPostEventDownloadXml(`<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><LatestEventDetails></LatestEventDetails>`)
    ).toThrow(/rejected/);
    expect(() => parseIndiaPostEventDownloadXml(`<?xml version="1.0"?><LatestEventDetails></LatestEventDetails>`)).not.toThrow();
  });

  it("merges the same article across days and drops duplicate scans", () => {
    const first = parseIndiaPostEventDownloadXml(SAMPLE);
    const second = parseIndiaPostEventDownloadXml(SAMPLE.replace("Item Dispatched", "Item Received").replace("153152", "090000"));
    const merged = mergeEventDownloadArticles([first[0]!, second[0]!, first[0]!]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.tracking_details?.map((event) => event.event)).toEqual(["Item Received", "Item Dispatched"]);
  });
});
