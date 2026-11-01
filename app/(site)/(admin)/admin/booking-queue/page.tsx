"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/hooks/use-api";

type QueueHealth = {
  queued: number;
  processing: number;
  staleQueued: number;
  retryScheduled: number;
  recoveryRequired: number;
  failed: number;
  overdueJobs: number;
  autoRecoveryEnabled: boolean;
  forceRetryEnabled: boolean;
  jobRunner: string;
};

const tiles: Array<{ key: keyof QueueHealth; label: string }> = [
  { key: "queued", label: "Queued" },
  { key: "processing", label: "Processing" },
  { key: "staleQueued", label: "Stuck" },
  { key: "retryScheduled", label: "Retry scheduled" },
  { key: "recoveryRequired", label: "Needs review" },
  { key: "failed", label: "Failed" },
];

export default function BookingQueueAdminPage() {
  const health = useQuery({
    queryKey: ["admin", "booking-queue"],
    queryFn: () => api<QueueHealth>("/api/admin/booking-queue"),
    refetchInterval: 30_000,
  });
  const data = health.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Booking queue"
        description="Counts only. Shipment details stay in each merchant workspace."
      />
      {health.error ? (
        <p className="text-sm text-error">{health.error instanceof Error ? health.error.message : "Could not load the queue."}</p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => (
          <Card key={tile.key}>
            <CardHeader>
              <CardTitle>{tile.label}</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">{data ? String(data[tile.key]) : "—"}</CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Runner</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Job runner: {data?.jobRunner ?? "—"}</p>
          <p>Overdue jobs: {data ? String(data.overdueJobs) : "—"}</p>
          <p>Force retry: {data ? (data.forceRetryEnabled ? "On" : "Off") : "—"}</p>
          <p>Automatic orphan recovery: {data ? (data.autoRecoveryEnabled ? "On" : "Off") : "—"}</p>
          <p className="text-muted">
            Automatic recovery stays off until BOOKING_AUTO_RECOVERY=true. It only requeues QUEUED shipments with no barcode and no booking job.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
