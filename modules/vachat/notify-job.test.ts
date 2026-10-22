import { describe, expect, it } from "vitest";
import { vachatNotifyJobKind } from "@/modules/vachat/notify-job";

describe("vachatNotifyJobKind", () => {
  it("routes signup_welcome away from notice jobs", () => {
    expect(vachatNotifyJobKind({ kind: "signup_welcome" })).toBe("signup_welcome");
  });

  it("keeps shipment jobs on the notice path", () => {
    expect(vachatNotifyJobKind({ event: "booked", shipmentId: "s1" })).toBe("notice");
    expect(vachatNotifyJobKind({})).toBe("notice");
  });

  it("keeps support and session text kinds", () => {
    expect(vachatNotifyJobKind({ kind: "session_text", source: "support" })).toBe("support");
    expect(vachatNotifyJobKind({ kind: "support_template" })).toBe("support");
    expect(vachatNotifyJobKind({ kind: "session_text" })).toBe("session_text");
  });
});
