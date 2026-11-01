import type { Metadata } from "next";
import { StorePreviewFrame } from "@/components/storefront/store-preview-frame";

export const metadata: Metadata = {
  title: "Storefront preview",
  robots: { index: false, follow: false },
};

/** Framed by the dashboard Storefront tab; renders only the draft it receives from a same-origin parent. */
export default function StorePreviewPage() {
  return <StorePreviewFrame />;
}
