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

export type IndiaPostOfficeConnection = {
  pickup_dropoff_office_id?: string | null;
  pickup_office_id?: string | null;
  pickup_office_pincode?: string | null;
};

export function indiaPostBookingOfficeId(
  pickupOrDropoff: "PICKUP" | "DROPOFF",
  connection: IndiaPostOfficeConnection,
  pickup?: IndiaPostPickupRow | null
) {
  const dropId = String(connection.pickup_dropoff_office_id ?? pickup?.office_id ?? "").trim();
  if (pickupOrDropoff !== "PICKUP") return dropId;
  const pickupId = String(connection.pickup_office_id ?? pickup?.office_id ?? "").trim();
  return pickupId || dropId;
}

export function cachedOfficeLookup(provider: OfficeLookup): OfficeLookup {
  const cache = new Map<string, Promise<IndiaPostOffice[]>>();
  return {
    searchPostOffices(pincode: string) {
      const pin = pincode.replace(/\D/g, "").slice(0, 6);
      const key = pin || pincode;
      const existing = cache.get(key);
      if (existing) return existing;
      const pending = provider.searchPostOffices(pincode);
      cache.set(key, pending);
      return pending;
    },
  };
}

export async function resolveIndiaPostOrigin(
  provider: OfficeLookup,
  connection: IndiaPostOfficeConnection,
  pickup: IndiaPostPickupRow | null,
  destPin: string,
  pickupOrDropoff: "PICKUP" | "DROPOFF" = "DROPOFF"
) {
  const officeId = indiaPostBookingOfficeId(pickupOrDropoff, connection, pickup);
  const configuredPickupPin = String(connection.pickup_office_pincode ?? "").replace(/\D/g, "").slice(0, 6);
  const originPin =
    pickupOrDropoff === "PICKUP" && /^\d{6}$/.test(configuredPickupPin)
      ? configuredPickupPin
      : /^\d{6}$/.test(pickup?.pincode ?? "")
        ? String(pickup?.pincode)
        : "";
  const originOffices = originPin ? await provider.searchPostOffices(originPin) : [];
  const destOffices = destPin && destPin !== originPin ? await provider.searchPostOffices(destPin) : originOffices;
  const matched =
    indiaPostFindOffice(originOffices, officeId) ||
    indiaPostFindOffice(destOffices, officeId) ||
    indiaPostPickDeliveryOffice(originOffices);
  const pincode = String(matched?.pincode ?? originPin ?? "");
  if (!officeId) {
    throw Object.assign(
      new Error(
        pickupOrDropoff === "PICKUP"
          ? "Pickup Officeid is required when pickup_or_dropoff is PICKUP. Save Pickup Location on Integrations → India Post."
          : "Dropoff Officeid is required when pickup_or_dropoff is DROPOFF. Save Drop-off office on Integrations → India Post."
      ),
      { code: "VALIDATION_ERROR" }
    );
  }
  if (officeId.length !== 8 || !/^\d+$/.test(officeId)) {
    throw Object.assign(
      new Error(
        pickupOrDropoff === "PICKUP"
          ? `Pickup Officeid must be exactly 8 digits (got ${officeId}).`
          : `Dropoff Officeid must be exactly 8 digits (got ${officeId}).`
      ),
      { code: "VALIDATION_ERROR" }
    );
  }
  if (!/^\d{6}$/.test(pincode)) {
    throw Object.assign(
      new Error(
        `Sender pincode must be exactly 6 digits (got ${pincode || "empty"}). Save the booking office from its 6-digit pincode on Integrations → India Post.`
      ),
      { code: "VALIDATION_ERROR" }
    );
  }
  if (!matched?.office_name) {
    throw Object.assign(
      new Error(
        `India Post pincode-search for ${pincode} did not return office ${officeId}. Search that pin again and save the office on Integrations → India Post.`
      ),
      { code: "VALIDATION_ERROR" }
    );
  }
  if (pincode === destPin && originPin !== destPin) {
    throw Object.assign(
      new Error(
        `India Post origin pin ${pincode} matched the receiver pin. Set the booking office pincode to the origin office, not the receiver.`
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
