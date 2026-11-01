"use client";

import { useQuery } from "@tanstack/react-query";
import { BulkExcelWizard } from "@/components/bookings/bulk-excel-wizard";
import { BookingQueueDashboard } from "@/components/booking-queue/booking-queue-dashboard";
import { QUEUE_SUMMARY_KEY } from "@/components/booking-queue/view";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/hooks/use-api";
import type { QueueSummary } from "@/modules/booking-queue/service";

/**
 * Workspaces in the Bulk Booking rollout get the queue dashboard. Everyone else, and anyone whose
 * summary cannot load, keeps the existing Excel wizard exactly as before.
 */
export function BulkBookingPage() {
  const summary = useQuery({
    queryKey: QUEUE_SUMMARY_KEY,
    queryFn: () => api<QueueSummary>("/api/v1/booking-queue/summary"),
    retry: false,
  });
  if (summary.isLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!summary.data?.enabled) return <BulkExcelWizard />;
  return <BookingQueueDashboard summary={summary.data} />;
}
