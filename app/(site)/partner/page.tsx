import Link from "next/link";
import { Card } from "@/components/ui/card";

export default function PartnerHomePage() {
  return (
    <main id="main-content" className="mx-auto w-full max-w-lg p-8">
      <Card className="space-y-4 p-6">
        <h1 className="text-2xl font-semibold">PostBus Partners</h1>
        <p className="text-sm text-muted">Refer merchants to PostBus. Use the same account you already use as a merchant.</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/partner/login" className="underline">Sign in</Link>
          <Link href="/partner/register" className="underline">Create an account</Link>
          <Link href="/partner/dashboard" className="underline">Open dashboard</Link>
        </div>
      </Card>
    </main>
  );
}
