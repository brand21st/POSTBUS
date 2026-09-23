"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Workflow } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { AutoLabelPrintingCard } from "@/components/dashboard/auto-label-printing-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { boolField } from "@/lib/dashboard/records";
import { api } from "@/lib/hooks/use-api";
import { useMe } from "@/lib/hooks/use-me";
import { hasPermission } from "@/lib/permissions/rbac";
import type { AutomationSettings } from "@/types/api";
import type { MemberRole } from "@/types/domain";

const TOGGLES = [
  {
    camel: "autoShopifySync",
    snake: "auto_shopify_sync",
    title: "Auto Shopify sync",
    description: "Import new and updated Shopify orders from store webhooks.",
  },
  {
    camel: "autoShipmentCreation",
    snake: "auto_shipment_creation",
    title: "Auto shipment creation",
    description: "Create a shipment when a Shopify order is imported.",
  },
  {
    camel: "autoBooking",
    snake: "auto_booking",
    title: "Auto booking",
    description: "Queue India Post booking for automatically created shipments.",
  },
  {
    camel: "autoLabelGeneration",
    snake: "auto_label_generation",
    title: "Auto label generation",
    description: "Generate a stored PDF after a successful booking.",
  },
  {
    camel: "autoLabelPrinting",
    snake: "auto_label_printing",
    title: "Auto Label Printing",
    description: "Automatically print shipping labels when they are generated.",
  },
  {
    camel: "autoManifest",
    snake: "auto_manifest",
    title: "Auto manifest",
    description: "After a booking and label, add the article to today's pickup manifest and keep that list in sync.",
  },
  {
    camel: "autoTrackingSync",
    snake: "auto_tracking_sync",
    title: "Auto tracking sync",
    description: "Pull India Post scan events into the tracking timeline.",
  },
  {
    camel: "autoShopifyFulfillment",
    snake: "auto_shopify_fulfillment",
    title: "Auto Shopify fulfillment",
    description:
      "When an order is booked, write the tracking id and tracking link to Shopify. Later In transit and Delivered statuses add the matching Shopify fulfillment events.",
  },
  {
    camel: "autoWatiOrderConfirmation",
    snake: "auto_wati_order_confirmation",
    title: "Wati · Order confirmation",
    description: "Send the Order confirmation template from Integrations → Wati when a Shopify order is imported.",
  },
  {
    camel: "autoWatiProcessing",
    snake: "auto_wati_processing",
    title: "Wati · Processing",
    description: "Send the Processing template when the order status becomes Processing, including the Orders page action.",
  },
  {
    camel: "autoWatiBooked",
    snake: "auto_wati_booked",
    title: "Wati · Booked / packed",
    description: "Send the Booked / packed template when India Post returns a tracking id, or when you choose Fulfill on Orders.",
  },
  {
    camel: "autoWatiInTransit",
    snake: "auto_wati_in_transit",
    title: "Wati · In transit",
    description: "Send the In transit template when India Post first moves the article, or when you mark In transit on Orders.",
  },
  {
    camel: "autoWatiDelivered",
    snake: "auto_wati_delivered",
    title: "Wati · Delivered",
    description: "Send the Delivered template when the shipment is delivered, or when you mark Delivered on Orders.",
  },
] as const;

export default function AutomationPage() {
  const queryClient = useQueryClient();
  const me = useMe();
  const canManage = hasPermission((me.data?.role ?? "VIEWER") as MemberRole, "automation.manage");

  const query = useQuery({
    queryKey: ["automation"],
    queryFn: () => api<AutomationSettings>("/api/v1/automation"),
  });

  const mutation = useMutation({
    mutationFn: (payload: Record<string, boolean>) =>
      api<AutomationSettings>("/api/v1/automation", {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: ["automation"] });
      const previous = queryClient.getQueryData<AutomationSettings>(["automation"]);
      queryClient.setQueryData<AutomationSettings>(["automation"], (current) => ({
        ...current,
        ...payload,
      }));
      return { previous };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["automation"], data);
      toast.success("Saved to your workspace.");
    },
    onError: (error: Error, _payload, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["automation"], context.previous);
      }
      toast.error(error.message);
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automation"
        description="These rules match the order stages on Orders and the Wati templates. Workers skip a step when that integration is not connected."
      />

      {query.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 13 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      ) : query.isError ? (
        <EmptyState
          icon={Workflow}
          title="Automation settings unavailable"
          description={query.error instanceof Error ? query.error.message : "Try again shortly."}
        />
      ) : (
        <div className="space-y-3">
          {TOGGLES.map((item) => {
            const checked = boolField(query.data as Record<string, unknown>, item.camel, item.snake);
            return (
              <Card key={item.camel}>
                <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                  <div>
                    <CardTitle>{item.title}</CardTitle>
                    <CardDescription className="mt-1">{item.description}</CardDescription>
                  </div>
                  <Switch
                    checked={checked}
                    disabled={!canManage || mutation.isPending}
                    onCheckedChange={(value) => mutation.mutate({ [item.camel]: value })}
                  />
                </CardHeader>
                {item.camel === "autoLabelPrinting" ? (
                  <AutoLabelPrintingCard enabled={checked} canManage={canManage} />
                ) : (
                  <CardContent className="pt-0 text-xs text-muted">
                    Workers skip this step when the related integration is not connected.
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
