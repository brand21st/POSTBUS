import { AffiliateAdminDashboard } from "@/components/affiliates/admin-dashboard";
import { affiliateEnabled } from "@/modules/affiliates/policy";
export const dynamic="force-dynamic";
export default function Page(){return affiliateEnabled()?<AffiliateAdminDashboard/>:<main className="p-8"><h1 className="text-2xl font-semibold">Affiliate management</h1><p>The partner program is disabled.</p></main>;}
