import { describe, expect, it } from "vitest";
import { approvedVachatTemplates, unwrapVachatData, withApprovedVachatTemplates } from "@/modules/vachat/templates";

describe("vachat template list parsing", () => {
  it("unwraps the VaChat { data } envelope", () => {
    expect(unwrapVachatData({ data: { booked_template_name: "booked" } })).toEqual({
      booked_template_name: "booked",
    });
  });

  it("reads approved_templates from the public PostBus payload", () => {
    expect(
      approvedVachatTemplates({
        data: {
          approved_templates: [{ name: "postbus_booked", language: "en", status: "APPROVED" }],
        },
      })
    ).toEqual([{ name: "postbus_booked", language: "en" }]);
  });

  it("skips non-approved templates and empty names", () => {
    expect(
      approvedVachatTemplates({
        approved_templates: [
          { name: "pending_one", status: "PENDING" },
          { name: "  ", language: "en" },
          { name: "ok_tpl", language: "hi" },
        ],
      })
    ).toEqual([{ name: "ok_tpl", language: "hi" }]);
  });

  it("attaches a normalized approved list for the admin dropdown", () => {
    const next = withApprovedVachatTemplates({
      data: { order_confirmation_template_name: null, approvedTemplates: [{ name: "hello" }] },
    });
    expect(next.order_confirmation_template_name).toBeNull();
    expect(next.approved_templates).toEqual([{ name: "hello", language: "en_US" }]);
  });
});
