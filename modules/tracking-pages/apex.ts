import { siteConfig } from "@/lib/site-config";
import { DEFAULT_BACKGROUND_COLOR, DEFAULT_PRIMARY_COLOR } from "./constants";
import type { TrackingPageRecord } from "@/types/api";

export function apexTrackingPage(): TrackingPageRecord {
  return {
    id: "postbus-apex",
    organizationId: "",
    subdomain: "",
    status: "PUBLISHED",
    storeName: siteConfig.name,
    tagline: "Track your India Post shipment",
    about: "Enter your India Post article number or barcode to see the latest scan events.",
    logoUrl: null,
    primaryColor: DEFAULT_PRIMARY_COLOR,
    backgroundColor: DEFAULT_BACKGROUND_COLOR,
    social: { website: siteConfig.url },
    banners: [],
    publicUrl: `${siteConfig.url}/track`,
  };
}
