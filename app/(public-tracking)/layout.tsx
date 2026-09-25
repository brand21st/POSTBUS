import type { ReactNode } from "react";
import type { Metadata } from "next";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = {
  ...noIndexMetadata,
  title: "Shipment tracking",
};

export default function PublicTrackingLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" className="min-h-full flex-1">
      {children}
    </main>
  );
}
