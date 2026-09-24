import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default function AdminSettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="System settings" description="Platform configuration is stored in environment variables and Super Admin screens." />
      <Card>
        <CardContent className="space-y-3 p-6 text-sm text-muted">
          <p>Razorpay credentials belong in RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and RAZORPAY_WEBHOOK_SECRET.</p>
          <p>Grant Super Admin access by inserting into platform_admins, or set PLATFORM_ADMIN_EMAIL to bootstrap the first operator.</p>
          <p>Trial length is edited under Trial Settings. Plan prices and order limits are edited under Plans.</p>
        </CardContent>
      </Card>
    </div>
  );
}
