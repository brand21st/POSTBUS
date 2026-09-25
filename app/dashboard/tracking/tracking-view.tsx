"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { TrackingPageEditor } from "./page-editor";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { asList } from "@/lib/dashboard/records";
import { formatDate } from "@/lib/format";
import { api, toSearchParams } from "@/lib/hooks/use-api";
import { usePlanEntitlements } from "@/lib/hooks/use-plan-entitlements";
import { FEATURE } from "@/modules/billing/entitlements";
import type { TrackingRecord } from "@/types/api";

export function TrackingView() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tracking"
        description="Provider scan events only. Missing scans are not invented."
      />
      <Tabs defaultValue="shipments">
        <TabsList>
          <TabsTrigger value="shipments">Shipments</TabsTrigger>
          <TabsTrigger value="page">Tracking page</TabsTrigger>
        </TabsList>
        <TabsContent value="shipments">
          <ShipmentsPanel />
        </TabsContent>
        <TabsContent value="page">
          <TrackingPageEditor />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ShipmentsPanel() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [debounced, setDebounced] = useState(query);
  const entitlements = usePlanEntitlements();
  const trackingAllowed = entitlements.allows(FEATURE.trackingPage);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const result = useQuery({
    queryKey: ["tracking", debounced],
    enabled: trackingAllowed,
    queryFn: () =>
      api<TrackingRecord[] | { items: TrackingRecord[] }>(
        `/api/v1/tracking?${toSearchParams({ q: debounced || undefined })}`
      ),
  });

  const records = asList<TrackingRecord>(result.data);

  return (
    <div className="space-y-4">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search tracking number, barcode, or order…"
        className="max-w-xl"
      />

      {result.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : result.isError ? (
        <EmptyState
          icon={Radio}
          title="Tracking unavailable"
          description={result.error instanceof Error ? result.error.message : "Try again shortly."}
        />
      ) : records.length === 0 ? (
        <EmptyState
          icon={Radio}
          title="No tracking events"
          description="Events appear after India Post reports a scan for a booked shipment."
        />
      ) : (
        <div className="space-y-4">
          {records.map((record) => (
            <Card key={record.id}>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>
                    {record.trackingNumber ?? record.tracking_number ?? record.barcode ?? record.id}
                  </CardTitle>
                  <p className="mt-1 text-sm text-muted">
                    Order {record.orderNumber ?? record.order_number ?? "—"}
                  </p>
                </div>
                <StatusBadge value={record.status} />
              </CardHeader>
              <CardContent>
                {(record.events ?? []).length === 0 ? (
                  <p className="text-sm text-muted">No events recorded for this shipment.</p>
                ) : (
                  <ol className="space-y-3">
                    {(record.events ?? []).map((event, index) => (
                      <li key={event.id ?? index} className="border-l border-border pl-4">
                        <p className="text-sm font-medium">
                          {event.eventDescription ?? event.event_description ?? event.eventCode}
                        </p>
                        <p className="text-xs text-muted">
                          {[
                            event.officeName ?? event.office_name,
                            formatDate(event.occurredAt ?? event.occurred_at, true),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
