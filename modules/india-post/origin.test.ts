import { describe, expect, it } from "vitest";
import { indiaPostBookingOfficeId, resolveIndiaPostOrigin } from "@/modules/india-post/origin";

describe("indiaPostBookingOfficeId", () => {
  it("uses the drop-off office for DROPOFF bookings", () => {
    expect(
      indiaPostBookingOfficeId(
        "DROPOFF",
        { pickup_dropoff_office_id: "22660454", pickup_office_id: "21360043" },
        null
      )
    ).toBe("22660454");
  });

  it("uses the pickup office for PICKUP bookings", () => {
    expect(
      indiaPostBookingOfficeId(
        "PICKUP",
        { pickup_dropoff_office_id: "22660454", pickup_office_id: "21360043" },
        null
      )
    ).toBe("21360043");
  });

  it("falls back to the drop-off office when pickup office is not saved", () => {
    expect(
      indiaPostBookingOfficeId("PICKUP", { pickup_dropoff_office_id: "22660454" }, null)
    ).toBe("22660454");
  });
});

describe("resolveIndiaPostOrigin", () => {
  it("keeps the booking office pin and uses dest offices for delivery name", async () => {
    const origin = await resolveIndiaPostOrigin(
      {
        async searchPostOffices(pin: string) {
          if (pin === "682311") {
            return [
              {
                office_id: "22660454",
                office_name: "Kolenchery SO",
                pincode: "682311",
                city_name: "Ernakulam",
                state_name: "Kerala",
              },
            ];
          }
          return [
            {
              office_id: "1",
              office_name: "Aluva HO",
              pincode: "683565",
              office_type_code: "HO",
            },
          ];
        },
      },
      { pickup_dropoff_office_id: "22660454" },
      { pincode: "682311", city: "Ernakulam", state: "Kerala" },
      "683565"
    );
    expect(origin.pincode).toBe("682311");
    expect(origin.name).toBe("Kolenchery SO");
    expect(origin.deliveryOfficeName).toBe("Aluva HO");
    expect(origin.officeId).toBe("22660454");
  });

  it("uses the configured pickup office pin for PICKUP origin", async () => {
    const origin = await resolveIndiaPostOrigin(
      {
        async searchPostOffices(pin: string) {
          if (pin === "570001") {
            return [
              {
                office_id: "21360043",
                office_name: "Mysuru H.O",
                pincode: "570001",
                city_name: "MYSURU",
                state_name: "Karnataka",
              },
            ];
          }
          return [];
        },
      },
      {
        pickup_dropoff_office_id: "22660454",
        pickup_office_id: "21360043",
        pickup_office_pincode: "570001",
      },
      { pincode: "682311" },
      "626003",
      "PICKUP"
    );
    expect(origin.officeId).toBe("21360043");
    expect(origin.pincode).toBe("570001");
    expect(origin.name).toBe("Mysuru H.O");
  });
});
