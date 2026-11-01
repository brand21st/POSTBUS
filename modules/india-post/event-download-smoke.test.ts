import { describe, expect, it } from "vitest";
import { classifyEventDownloadSmoke } from "@/modules/india-post/event-download-smoke";

const XML = `<?xml version="1.0"?><LatestEventDetails>
<ArticleDetails>
<ArticleNumber>EY592889005IN</ArticleNumber>
<EventCode>ITEM_BOOK</EventCode>
<EventDescription>Item Booked</EventDescription>
<EventDate>21102026</EventDate>
<EventTime>143000</EventTime>
</ArticleDetails>
</LatestEventDetails>`;

describe("read-only Event Download smoke classifier", () => {
  it("PASSes 200 XML containing the known AWB", () => {
    const report = classifyEventDownloadSmoke({
      httpStatus: 200,
      contentType: "application/xml",
      body: XML,
      knownAwb: "EY592889005IN",
    });
    expect(report.verdict).toBe("PASS");
    expect(report.xmlValid).toBe(true);
    expect(report.articleCount).toBe(1);
    expect(report.knownAwbPresent).toBe(true);
    expect(report.eventDatesValid).toBe(true);
    expect(report.descriptionsParsed).toBe(true);
  });

  it("is PARTIAL when XML is valid but the AWB is absent", () => {
    const report = classifyEventDownloadSmoke({
      httpStatus: 200,
      contentType: "text/xml",
      body: XML,
      knownAwb: "CX075364450IN",
    });
    expect(report.verdict).toBe("PARTIAL");
    expect(report.knownAwbPresent).toBe(false);
  });

  it("treats 204 and empty bodies as INCONCLUSIVE", () => {
    expect(classifyEventDownloadSmoke({ httpStatus: 204, body: "" }).verdict).toBe("INCONCLUSIVE");
    expect(classifyEventDownloadSmoke({ httpStatus: 200, body: "   " }).verdict).toBe("INCONCLUSIVE");
  });

  it("BLOCKs 403 and FAILs 401 or invalid XML", () => {
    expect(classifyEventDownloadSmoke({ httpStatus: 403 }).verdict).toBe("BLOCKED");
    expect(classifyEventDownloadSmoke({ httpStatus: 401 }).verdict).toBe("FAIL");
    expect(
      classifyEventDownloadSmoke({ httpStatus: 200, body: '{"not":"xml"}', knownAwb: "EY592889005IN" }).verdict
    ).toBe("FAIL");
  });
});
