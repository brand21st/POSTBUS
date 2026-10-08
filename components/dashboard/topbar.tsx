"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ChevronRight, Menu, Search } from "lucide-react";
import { toast } from "sonner";
import { CommandSearch } from "@/components/dashboard/command-search";
import { ServiceToggle } from "@/components/dashboard/service-toggle";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { breadcrumbs, isResourceIdSegment } from "@/lib/dashboard/nav";
import { formatRelative, initials } from "@/lib/format";
import { orderNumber, shipmentNumber } from "@/lib/dashboard/records";
import { api } from "@/lib/hooks/use-api";
import { INDIA_POST_QUERY_KEY, useIndiaPost } from "@/lib/hooks/use-india-post";
import { useNotifications } from "@/lib/hooks/use-notifications";
import { parcelServiceCode } from "@/modules/india-post/booking-service";
import { hideWorkspaceBookingToggle } from "@/modules/india-post/contracts";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { indiaPostServiceLabel } from "@/types/domain";
import type { IndiaPostConfig, MeResponse, OrderRecord, ShipmentRecord } from "@/types/api";

export function Topbar({
  me,
  onMenuClick,
}: {
  me?: MeResponse | null;
  onMenuClick: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const crumbs = useMemo(() => breadcrumbs(pathname), [pathname]);
  const orderCrumbId = crumbs.find((crumb) => crumb.resourceId && crumb.href.startsWith("/dashboard/orders/"))?.label;
  const shipmentCrumbId = crumbs.find((crumb) => crumb.resourceId && crumb.href.startsWith("/dashboard/shipments/"))?.label;
  const order = useQuery({
    queryKey: ["order", orderCrumbId],
    queryFn: () => api<OrderRecord>(`/api/v1/orders/${orderCrumbId}`),
    enabled: Boolean(orderCrumbId && isResourceIdSegment(orderCrumbId)),
    staleTime: 30_000,
  });
  const shipment = useQuery({
    queryKey: ["shipment", shipmentCrumbId],
    queryFn: () => api<ShipmentRecord>(`/api/v1/shipments/${shipmentCrumbId}`),
    enabled: Boolean(shipmentCrumbId && isResourceIdSegment(shipmentCrumbId)),
    staleTime: 30_000,
  });
  const orderCrumbLabel = order.data ? orderNumber(order.data) : null;
  const shipmentCrumbLabel = shipment.data ? shipmentNumber(shipment.data) : null;
  const indiaPost = useIndiaPost();
  const defaultServiceLabel = indiaPostServiceLabel(
    indiaPost.data?.defaultServiceCode ?? "SP_INLAND_PARCEL"
  );
  const bookingOptions = [
    {
      value: "DEFAULT",
      label: "Default",
      title: `Use the India Post default service (${defaultServiceLabel})`,
    },
    { value: "SP_INLAND_PARCEL", label: "SP", title: "Speed Post Parcel Domestic" },
    { value: "BUSINESS_PARCEL", label: "BP", title: "Business Parcel" },
  ];
  const bookingService = useMutation({
    mutationFn: (service: string) =>
      api<{ bookingServiceOverride: string | null; serviceCode: string }>(
        "/api/v1/integrations/india-post/booking-service",
        {
          method: "PATCH",
          body: JSON.stringify({ service }),
        }
      ),
    onSuccess: (data) => {
      queryClient.setQueryData<IndiaPostConfig>(INDIA_POST_QUERY_KEY, (current) =>
        current ? { ...current, bookingServiceOverride: data.bookingServiceOverride } : current
      );
      queryClient.invalidateQueries({ queryKey: INDIA_POST_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const bookingValue = parcelServiceCode(indiaPost.data?.bookingServiceOverride) ?? "DEFAULT";
  const canChangeBooking = me?.role !== "VIEWER";
  const [searchOpen, setSearchOpen] = useState(false);
  const notifications = useNotifications();
  const items = notifications.items;
  const unread = notifications.unread;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function signOut() {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // still leave the product surface
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex h-16 items-center gap-3 border-b border-border bg-background px-4 lg:px-6">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onMenuClick}
        aria-label="Open navigation"
      >
        <Menu className="size-4" />
      </Button>

      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1 text-sm md:flex">
        {crumbs.map((crumb, index) => (
          <span key={crumb.href} className="flex min-w-0 items-center gap-1">
            {index > 0 ? <ChevronRight className="size-3.5 text-muted" /> : null}
            <Link
              href={crumb.href}
              prefetch={false}
              className={cn(
                "truncate hover:text-brand",
                crumb.resourceId ? "font-medium normal-case" : "capitalize",
                index === crumbs.length - 1 ? "font-medium text-ink" : "text-muted"
              )}
            >
              {crumb.resourceId && crumb.href.startsWith("/dashboard/orders/")
                ? orderCrumbLabel ?? "…"
                : crumb.resourceId && crumb.href.startsWith("/dashboard/shipments/")
                  ? shipmentCrumbLabel ?? "…"
                  : crumb.label}
            </Link>
          </span>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-1.5">
        {hideWorkspaceBookingToggle(indiaPost.data) ? null : (
        <ServiceToggle
          label="India Post booking service"
          value={bookingValue}
          options={bookingOptions}
          disabled={!canChangeBooking || bookingService.isPending}
          onChange={(service) => {
            if (service !== bookingValue) bookingService.mutate(service);
          }}
        />
        )}
        <div className="flex items-center" data-tour="search">
          <Button
            type="button"
            variant="secondary"
            className="hidden h-10 w-72 justify-start font-normal text-muted md:inline-flex"
            onClick={() => setSearchOpen(true)}
          >
            <Search className="size-4" />
            <span className="truncate">Search orders, AWB…</span>
            <span className="ml-auto text-xs text-muted">⌘K</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
          >
            <Search className="size-4" />
          </Button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label="Notifications" className="relative">
              <Bell className="size-4" />
              {unread > 0 ? (
                <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-brand" />
              ) : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notifications.isError ? (
              <p className="px-3 py-6 text-sm text-error">
                {notifications.error instanceof Error
                  ? notifications.error.message
                  : "Could not load notifications."}
              </p>
            ) : items.length === 0 ? (
              <p className="px-3 py-6 text-sm text-muted">No notifications yet.</p>
            ) : (
              items.slice(0, 8).map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  className="flex-col items-start gap-0.5"
                  onClick={() => {
                    if (item.href) router.push(item.href);
                  }}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="font-medium">{item.title}</span>
                    {!item.readAt && !item.read_at ? <span className="size-1.5 rounded-full bg-brand" /> : null}
                  </span>
                  {item.body ? <span className="text-xs text-muted">{item.body}</span> : null}
                  <span className="text-[11px] text-muted">{formatRelative(item.createdAt ?? item.created_at)}</span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="hidden max-w-[180px] truncate rounded-lg border border-border bg-surface-soft px-3 py-1.5 text-sm font-medium text-ink sm:inline-block">
          {me?.organization?.name ?? "Workspace"}
        </span>

        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`${initials(me?.user.fullName ?? me?.user.email)} profile`}
            >
              <span
                aria-hidden
                className="flex size-8 items-center justify-center rounded-full bg-rose-100 text-xs font-semibold text-brand-dark"
              >
                {initials(me?.user.fullName ?? me?.user.email)}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="truncate">{me?.user.fullName ?? "Account"}</div>
              <div className="truncate text-xs font-normal text-muted">{me?.user.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/dashboard/settings")}>
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/dashboard/billing")}>
              Billing
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut}>Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}
