import { describe, expect, it } from "vitest";
import {
  LEGACY_TRIAL_END_UTC,
  NEW_TRIAL_DAYS,
  TRIAL_COHORT_LEGACY,
  TRIAL_COHORT_ROLLING,
  remainingTrialDays,
  trialBannerCopy,
  trialCohortForOrganization,
  trialEndForOrganization,
  trialIsLive,
} from "@/modules/billing/trial-policy";

describe("trialEndForOrganization", () => {
  it("expires October 20 accounts at November 1 00:00 IST", () => {
    const end = trialEndForOrganization("2026-10-20T08:15:00.000+05:30");
    expect(trialCohortForOrganization("2026-10-20T08:15:00.000+05:30")).toBe(TRIAL_COHORT_LEGACY);
    expect(end.toISOString()).toBe(LEGACY_TRIAL_END_UTC);
  });

  it("expires October 26 accounts at November 1 00:00 IST", () => {
    expect(trialEndForOrganization("2026-10-26T23:59:59.000+05:30").toISOString()).toBe(LEGACY_TRIAL_END_UTC);
    expect(trialCohortForOrganization("2026-10-26T23:59:59.000+05:30")).toBe(TRIAL_COHORT_LEGACY);
  });

  it("gives October 27 signups a 7-day trial from registration time", () => {
    const created = "2026-10-27T11:20:00.000+05:30";
    const end = trialEndForOrganization(created);
    expect(trialCohortForOrganization(created)).toBe(TRIAL_COHORT_ROLLING);
    expect(end.toISOString()).toBe(new Date("2026-11-03T11:20:00.000+05:30").toISOString());
  });

  it("gives October 30 signups a 7-day trial from registration time", () => {
    const created = "2026-10-30T18:00:00.000+05:30";
    expect(trialEndForOrganization(created).toISOString()).toBe(new Date("2026-11-06T18:00:00.000+05:30").toISOString());
  });

  it("gives November 1 signups a 7-day trial, not a same-day expiry", () => {
    const created = "2026-11-01T09:00:00.000+05:30";
    expect(trialEndForOrganization(created).toISOString()).toBe(new Date("2026-11-08T09:00:00.000+05:30").toISOString());
  });

  it("does not add another 7 days on top of the legacy November 1 cutoff", () => {
    const first = trialEndForOrganization("2026-10-15T00:00:00.000+05:30");
    const again = trialEndForOrganization("2026-10-15T00:00:00.000+05:30");
    expect(first.toISOString()).toBe(LEGACY_TRIAL_END_UTC);
    expect(again.toISOString()).toBe(first.toISOString());
    expect(NEW_TRIAL_DAYS).toBe(7);
  });
});

describe("trialIsLive", () => {
  it("is live only while TRIAL and trial_end is in the future", () => {
    const now = Date.parse("2026-10-30T12:00:00.000Z");
    expect(trialIsLive({ status: "TRIAL", trial_end: "2026-10-31T18:30:00.000Z" }, now)).toBe(true);
    expect(trialIsLive({ status: "TRIAL", trial_end: "2026-10-29T18:30:00.000Z" }, now)).toBe(false);
    expect(trialIsLive({ status: "EXPIRED", trial_end: "2026-11-10T18:30:00.000Z" }, now)).toBe(false);
    expect(trialIsLive({ status: "ACTIVE", trial_end: "2026-11-10T18:30:00.000Z" }, now)).toBe(false);
  });
});

describe("trialBannerCopy", () => {
  it("uses the November 1 date for legacy trials", () => {
    const copy = trialBannerCopy({
      trial: true,
      coverageEnded: false,
      trialEnd: LEGACY_TRIAL_END_UTC,
      cohort: TRIAL_COHORT_LEGACY,
      now: Date.parse("2026-10-30T06:00:00.000Z"),
    });
    expect(copy?.title).toBe("Business Plan Free Trial");
    expect(copy?.message).toContain("November 1, 2026");
  });

  it("uses remaining days for rolling 7-day trials", () => {
    const copy = trialBannerCopy({
      trial: true,
      coverageEnded: false,
      trialEnd: "2026-11-06T12:30:00.000Z",
      cohort: TRIAL_COHORT_ROLLING,
      now: Date.parse("2026-11-01T12:30:00.000Z"),
    });
    expect(copy?.message).toBe("5 days remaining in your Business Plan trial.");
    expect(remainingTrialDays("2026-11-06T12:30:00.000Z", Date.parse("2026-11-01T12:30:00.000Z"))).toBe(5);
  });

  it("asks expired accounts to upgrade", () => {
    const copy = trialBannerCopy({
      trial: false,
      coverageEnded: true,
      trialEnd: LEGACY_TRIAL_END_UTC,
    });
    expect(copy?.message).toBe("Your free trial has ended. Upgrade now to continue using PostBus.");
    expect(copy?.ctaLabel).toBe("Upgrade Now");
  });
});
