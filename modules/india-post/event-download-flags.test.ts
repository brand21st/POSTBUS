import { afterEach, describe, expect, it } from "vitest";
import {
  indiaPostEventDownloadOrgAllowlist,
  isIndiaPostEventDownloadOpenForOrg,
} from "@/modules/india-post/event-download-flags";

describe("Event Download org allowlist", () => {
  const previous = process.env.INDIA_POST_EVENT_DOWNLOAD_ORG_ALLOWLIST;

  afterEach(() => {
    if (previous == null) delete process.env.INDIA_POST_EVENT_DOWNLOAD_ORG_ALLOWLIST;
    else process.env.INDIA_POST_EVENT_DOWNLOAD_ORG_ALLOWLIST = previous;
  });

  it("defaults to all orgs outside production", () => {
    delete process.env.INDIA_POST_EVENT_DOWNLOAD_ORG_ALLOWLIST;
    expect(indiaPostEventDownloadOrgAllowlist()).toEqual(["*"]);
    expect(isIndiaPostEventDownloadOpenForOrg("11111111-1111-4111-8111-111111111111")).toBe(true);
  });

  it("disables every org when production allowlist is empty", () => {
    const nodeEnv = process.env.NODE_ENV;
    process.env.INDIA_POST_EVENT_DOWNLOAD_ORG_ALLOWLIST = "";
    process.env.NODE_ENV = "production";
    try {
      expect(indiaPostEventDownloadOrgAllowlist()).toEqual([]);
      expect(isIndiaPostEventDownloadOpenForOrg("11111111-1111-4111-8111-111111111111")).toBe(false);
    } finally {
      process.env.NODE_ENV = nodeEnv;
    }
  });

  it("allows only listed organization ids", () => {
    process.env.INDIA_POST_EVENT_DOWNLOAD_ORG_ALLOWLIST = "11111111-1111-4111-8111-111111111111";
    expect(isIndiaPostEventDownloadOpenForOrg("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isIndiaPostEventDownloadOpenForOrg("22222222-2222-4222-8222-222222222222")).toBe(false);
  });
});
