import { describe, expect, it } from "vitest";
import { resolveIndiaPostOrigin } from "@/modules/india-post/origin";

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
  });
});
