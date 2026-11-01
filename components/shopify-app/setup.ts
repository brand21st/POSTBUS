import type { IndiaPostSettings } from "@/components/shopify-app/types";

export type SetupStep = {
  id: "india-post" | "contract" | "parcel" | "first-shipment";
  label: string;
  help: string;
  action: string;
  href: string;
  done: boolean;
};

/** Onboarding checklist for Home, derived from India Post settings and how many shipments are booked. */
export function setupChecklist(settings: IndiaPostSettings, bookedCount: number): SetupStep[] {
  const connected = String(settings.status).toUpperCase() === "CONNECTED";
  const hasContract = settings.contracts.some((contract) => contract.isActive !== false && contract.contractId);
  const hasParcel = Boolean(
    settings.defaultWeightGrams && settings.defaultLengthCm && settings.defaultWidthCm && settings.defaultHeightCm
  );
  return [
    {
      id: "india-post",
      label: "Connect your India Post account",
      help: "Your bulk customer ID and password let PostBus book shipments for you.",
      action: "Connect",
      href: "/shopify/settings",
      done: connected,
    },
    {
      id: "contract",
      label: "Add your India Post contract",
      help: "Speed Post or Business Parcel contract ID from India Post.",
      action: "Add contract",
      href: "/shopify/settings#contract",
      done: hasContract,
    },
    {
      id: "parcel",
      label: "Set a default parcel size and weight",
      help: "Used when a product has no weight or dimensions in Shopify.",
      action: "Set defaults",
      href: "/shopify/settings#parcel",
      done: hasParcel,
    },
    {
      id: "first-shipment",
      label: "Book your first shipment",
      help: "Pick an order and book it with India Post.",
      action: "Go to orders",
      href: "/shopify/orders",
      done: bookedCount > 0,
    },
  ];
}
