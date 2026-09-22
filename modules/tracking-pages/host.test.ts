import { describe, expect, it } from "vitest";
import {
  classifySubdomain,
  customerTrackingLink,
  parseTrackingSubdomain,
  subdomainCandidates,
  trackingPagePublicUrl,
} from "./host";

describe("parseTrackingSubdomain", () => {
  it("keeps apex and localhost on the marketing host", () => {
    expect(parseTrackingSubdomain("localhost:3000")).toBeNull();
    expect(parseTrackingSubdomain("127.0.0.1:3000")).toBeNull();
    expect(parseTrackingSubdomain("postbus.in")).toBeNull();
    expect(parseTrackingSubdomain("www.postbus.in")).toBeNull();
    expect(parseTrackingSubdomain("postbus.vachat.in")).toBeNull();
    expect(parseTrackingSubdomain("www.postbus.vachat.in")).toBeNull();
  });

  it("does not treat the separate vachat.in project as PostBus", () => {
    expect(parseTrackingSubdomain("vachat.in")).toBeNull();
    expect(parseTrackingSubdomain("www.vachat.in")).toBeNull();
    expect(parseTrackingSubdomain("shop.vachat.in")).toBeNull();
    expect(parseTrackingSubdomain("app.vachat.in")).toBeNull();
  });

  it("reads merchant labels from postbus and localhost hosts", () => {
    expect(parseTrackingSubdomain("priya-stores.postbus.in")).toBe("priya-stores");
    expect(parseTrackingSubdomain("priya.postbus.in")).toBe("priya");
    expect(parseTrackingSubdomain("priya-stores.postbus.vachat.in")).toBe("priya-stores");
    expect(parseTrackingSubdomain("priya-stores.localhost:3000")).toBe("priya-stores");
  });

  it("rejects reserved labels", () => {
    expect(parseTrackingSubdomain("www.postbus.in")).toBeNull();
    expect(parseTrackingSubdomain("api.postbus.in")).toBeNull();
    expect(parseTrackingSubdomain("dashboard.localhost:3000")).toBeNull();
  });
});

describe("classifySubdomain", () => {
  it("flags reserved, invalid, and ok values", () => {
    expect(classifySubdomain("www").reason).toBe("reserved");
    expect(classifySubdomain("Priya Stores").reason).toBe("invalid");
    expect(classifySubdomain("priya-stores").reason).toBe("ok");
  });
});

describe("subdomainCandidates", () => {
  it("builds a tracking subdomain from a workspace or store name", () => {
    expect(subdomainCandidates("AURIMO BY NISH")[0]).toBe("aurimo-by-nish");
    expect(subdomainCandidates("Priya's Store")[0]).toBe("priya-s-store");
    expect(subdomainCandidates("Northwind Retail")[0]).toBe("northwind-retail");
  });

  it("skips reserved labels and offers the next free suffix", () => {
    expect(subdomainCandidates("admin")[0]).toBe("admin-2");
    expect(subdomainCandidates("!!!")[0]).toBe("store");
  });
});

describe("customerTrackingLink", () => {
  it("attaches the tracking id to the customer page", () => {
    expect(customerTrackingLink("https://priya.postbus.in", "CL556974704IN")).toBe(
      "https://priya.postbus.in/?tracking=CL556974704IN"
    );
  });
});

describe("trackingPagePublicUrl", () => {
  it("builds a public host from the current app URL", () => {
    expect(trackingPagePublicUrl("priya-stores")).toMatch(/priya-stores\.(localhost|postbus\.in)/);
  });
});
