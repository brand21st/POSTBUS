import {
  indiaPostFindOffice,
  indiaPostPickDeliveryOffice,
  type IndiaPostOffice,
} from "@/modules/india-post/endpoints";

export type IndiaPostPickupRow = {
  name?: string | null;
  contact_name?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  phone?: string | null;
  office_id?: string | null;
};

type OfficeLookup = {
  searchPostOffices: (pincode: string) => Promise<IndiaPostOffice[]>;
};

export async function resolveIndiaPostOrigin(
  provider: OfficeLookup,
  connection: { pickup_dropoff_office_id?: string | null },
  pickup: IndiaPostPickupRow | null,
  destPin: string
) {
  const officeId = String(connection.pickup_dropoff_office_id ?? pickup?.office_id ?? "").trim();
  const originPin = /^\d{6}$/.test(pickup?.pincode ?? "") ? String(pickup?.pincode) : "";
  const originOffices = originPin ? await provider.searchPostOffices(originPin) : [];
  const destOffices = destPin && destPin !== originPin ? await provider.searchPostOffices(destPin) : originOffices;
  const matched =
    indiaPostFindOffice(originOffices, officeId) ||
    indiaPostFindOffice(destOffices, officeId) ||
    indiaPostPickDeliveryOffice(originOffices);
  const pincode = String(matched?.pincode ?? originPin ?? "");
  if (!officeId || officeId.length !== 8 || !/^\d{6}$/.test(pincode) || !matched?.office_name) {
    throw Object.assign(
      new Error(
        "Add a pickup location with the 6-digit pincode of your India Post booking office (Kolenchery SO is 682311 for office 22660454). Drop-off pincode must be the origin office, not the receiver."
      ),
      { code: "VALIDATION_ERROR" }
    );
  }
  if (pincode === destPin && originPin !== destPin) {
    throw Object.assign(
      new Error(
        "India Post drop-off pincode was resolving to the receiver pin. Set pickup location pincode to your booking office pin."
      ),
      { code: "VALIDATION_ERROR" }
    );
  }
  return {
    officeId,
    pincode,
    name: String(matched.office_name),
    city: String(matched.city_name ?? pickup?.city ?? "Ernakulam"),
    state: String(matched.state_name ?? pickup?.state ?? "Kerala"),
    deliveryOfficeName: indiaPostPickDeliveryOffice(destOffices)?.office_name,
  };
}
