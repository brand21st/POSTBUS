import type { ReactNode } from "react";
import { affiliateEnabled } from "@/modules/affiliates/policy";
export const dynamic = "force-dynamic";
export const metadata = { title: "PostBus Partners", robots: { index: false, follow: false } };
export default function PartnerLayout({ children }: {
    children: ReactNode;
}) {
    if (!affiliateEnabled())
        return <main id="main-content" className="p-12"><h1 className="text-2xl font-semibold">PostBus Partners</h1><p className="mt-3">The partner program is not open yet.</p></main>;
    return children;
}
