import { describe, expect, it } from "vitest";
import { isPermanentVachatNotifyFailure } from "@/modules/vachat/logs";
import { vachatExternalRef } from "@/modules/vachat/send";

describe("vachat notification log rules", () => {
  it("keeps external_ref unique per event and entity", () => {
    expect(vachatExternalRef("booked", { shipmentId: "s1" })).toBe("postbus:booked:s1");
    expect(vachatExternalRef("delivered", { shipmentId: "s1" })).toBe("postbus:delivered:s1");
  });

  it("treats template and phone errors as permanent", () => {
    expect(isPermanentVachatNotifyFailure("template_missing", 400)).toBe(true);
    expect(isPermanentVachatNotifyFailure("notification_disabled", 400)).toBe(true);
    expect(isPermanentVachatNotifyFailure("bad_request", 400)).toBe(true);
    expect(isPermanentVachatNotifyFailure("HTTP_503", 503)).toBe(false);
    expect(isPermanentVachatNotifyFailure(undefined, 503)).toBe(false);
  });
});
