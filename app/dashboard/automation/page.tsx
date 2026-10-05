"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Workflow } from "lucide-react";
import { toast } from "sonner";
import { PlanLock } from "@/components/billing/plan-lock";
import { PageHeader } from "@/components/dashboard/page-header";
import { AutoLabelPrintingCard } from "@/components/dashboard/auto-label-printing-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { boolField, isMerchantVachatConnected, isWatiConnected } from "@/lib/dashboard/records";
import { api } from "@/lib/hooks/use-api";
import { useMe } from "@/lib/hooks/use-me";
import { usePlanEntitlements } from "@/lib/hooks/use-plan-entitlements";
import { hasPermission } from "@/lib/permissions/rbac";
import { automationToggleLock, FEATURE } from "@/modules/billing/entitlements";
import type { AutomationSettings, IntegrationsResponse } from "@/types/api";
import type { MemberRole } from "@/types/domain";

const TOGGLES = [
  {
    camel: "autoShopifySync",
    snake: "auto_shopify_sync",
    title: "Auto Shopify sync",
    description: "Import new and updated Shopify orders from store webhooks into PostBus.",
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
    description:
      "Poll India Post for scan events. CEPT webhooks still update tracking, order status, Shopify, and WhatsApp even when this is off.",
  },
  {
    camel: "autoShopifyFulfillment",
    snake: "auto_shopify_fulfillment",
    title: "Auto Shopify fulfillment",
    description:
      "On booking, write the tracking id to Shopify. CEPT In transit and Delivered scans add the matching Shopify fulfillment events.",
  },
] as const;

const WHATSAPP_TOGGLES = [
  {
    camel: "autoWatiBooked",
    snake: "auto_wati_booked",
    event: "booked" as const,
    watiTitle: "Wati · Booked / packed",
    merchantTitle: "Vachat · Booked / packed",
    vachatTitle: "PostBus WhatsApp · Booked / packed",
    description: "Sent when the India Post shipping label is generated. This starts the WhatsApp flow.",
  },
  {
    camel: "autoWatiInTransit",
    snake: "auto_wati_in_transit",
    event: "in_transit" as const,
    watiTitle: "Wati · In transit",
    merchantTitle: "Vachat · In transit",
    vachatTitle: "PostBus WhatsApp · In transit",
    description: "After the label exists, when an India Post CEPT scan first moves the article.",
  },
  {
    camel: "autoWatiDelivered",
    snake: "auto_wati_delivered",
    event: "delivered" as const,
    watiTitle: "Wati · Delivered",
    merchantTitle: "Vachat · Delivered",
    vachatTitle: "PostBus WhatsApp · Delivered",
    description: "After the label exists, when CEPT reports consignee delivery.",
  },
] as const;

export default function AutomationPage() {
  const queryClient = useQueryClient();
  const me = useMe();
  const entitlements = usePlanEntitlements();
  const [lock, setLock] = useState<{ camel: string; feature: string } | null>(null);
  const canManage = hasPermission((me.data?.role ?? "VIEWER") as MemberRole, "automation.manage");

  const query = useQuery({
    queryKey: ["automation"],
    queryFn: () => api<AutomationSettings>("/api/v1/automation"),
  });

  const integrations = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api<IntegrationsResponse>("/api/v1/integrations"),
  });
  const postbusWhatsapp = integrations.data?.postbusWhatsapp;
  const watiActive = isWatiConnected(integrations.data);
  const merchantVachatActive = isMerchantVachatConnected(integrations.data);
  const platformWhatsApp = Boolean(
    !merchantVachatActive &&
      ((postbusWhatsapp?.status ?? "").toUpperCase() === "CONNECTED" || postbusWhatsapp?.platformManaged)
  );
  const channelReady = !integrations.isLoading;
  const showWatiToggles = channelReady && watiActive;
  const showVachatToggles = channelReady && !watiActive;

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
        description="Shopify import, India Post booking, CEPT tracking, order status, Shopify fulfillment events, and WhatsApp templates for this workspace."
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
          <Card>
            <CardHeader>
              <CardTitle>Live order path</CardTitle>
              <CardDescription>
                {showWatiToggles
                  ? "Wati is connected, so template messages use Wati. PostBus WhatsApp is paused. Messages start when the India Post label is generated."
                  : merchantVachatActive
                    ? "Your Vachat integration is connected, so PostBus WhatsApp Notifications are paused. Messages start when the India Post label is generated."
                    : "PostBus WhatsApp templates start when the India Post label is generated. Connect Wati or Vachat to switch this workspace away from the official PostBus number."}
              </CardDescription>
            </CardHeader>
          </Card>
          {TOGGLES.map((item) => {
            const checked = boolField(query.data as Record<string, unknown>, item.camel, item.snake);
            const lockedFeature = lock?.camel === item.camel ? lock.feature : null;
            return (
              <PlanLock
                key={item.camel}
                compact
                locked={Boolean(lockedFeature)}
                feature={lockedFeature}
                onDismiss={() => setLock(null)}
              >
                <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                  <div>
                    <CardTitle>{item.title}</CardTitle>
                    <CardDescription className="mt-1">{item.description}</CardDescription>
                  </div>
                  <Switch
                    checked={checked}
                    disabled={!canManage || mutation.isPending}
                    onCheckedChange={(value) => {
                      const feature = automationToggleLock(item.camel, entitlements.allows);
                      if (feature) {
                        setLock({ camel: item.camel, feature });
                        return;
                      }
                      mutation.mutate({ [item.camel]: value });
                    }}
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
              </PlanLock>
            );
          })}
          {(showWatiToggles || showVachatToggles) &&
            WHATSAPP_TOGGLES.map((item) => {
              const checked = boolField(query.data as Record<string, unknown>, item.camel, item.snake);
              const lockedFeature = lock?.camel === item.camel ? lock.feature : null;
              const platformEventOff =
                showVachatToggles &&
                !merchantVachatActive &&
                platformWhatsApp &&
                postbusWhatsapp?.eventSettings?.[item.event] === false;
              return (
                <PlanLock
                  key={item.camel}
                  compact
                  locked={Boolean(lockedFeature)}
                  feature={lockedFeature}
                  onDismiss={() => setLock(null)}
                >
                  <Card>
                    <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                      <div>
                        <CardTitle>
                          {showWatiToggles
                            ? item.watiTitle
                            : merchantVachatActive
                              ? item.merchantTitle
                              : item.vachatTitle}
                        </CardTitle>
                        <CardDescription className="mt-1">{item.description}</CardDescription>
                      </div>
                      <Switch
                        checked={checked}
                        disabled={!canManage || mutation.isPending}
                        onCheckedChange={(value) => {
                          const feature = showWatiToggles
                            ? automationToggleLock(item.camel, entitlements.allows)
                            : entitlements.allows(FEATURE.automation)
                              ? null
                              : FEATURE.automation;
                          if (feature) {
                            setLock({ camel: item.camel, feature });
                            return;
                          }
                          mutation.mutate({ [item.camel]: value });
                        }}
                      />
                    </CardHeader>
                    <CardContent className="pt-0 text-xs text-muted">
                      {showWatiToggles
                        ? "Uses your Wati templates. PostBus WhatsApp will not send while Wati is connected."
                        : merchantVachatActive
                          ? "Uses your Vachat account. PostBus WhatsApp Notifications will not send while Vachat is connected."
                        : platformEventOff
                          ? "Super Admin must enable the matching PostBus WhatsApp event and template before this sends."
                          : "Uses the official PostBus WhatsApp number."}
                    </CardContent>
                  </Card>
                </PlanLock>
              );
            })}
        </div>
      )}
    </div>
  );
}
