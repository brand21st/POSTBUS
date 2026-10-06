import type { ComponentType } from "react";
import {
  LayoutDashboard,
  BarChart3,
  ShoppingBag,
  Truck,
  PackageX,
  Tag,
  Receipt,
  ClipboardList,
  Radio,
  Workflow,
  Plug,
  CreditCard,
  Settings,
  LifeBuoy,
} from "lucide-react";
import { YoutubeIcon } from "@/components/icons/youtube-icon";

export type NavItem = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  tour?: string;
};

export const sidebarNav: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Analytics", href: "/dashboard/analytics", icon: BarChart3 },
  { label: "Orders", href: "/dashboard/orders", icon: ShoppingBag, tour: "nav-orders" },
  { label: "Shipments", href: "/dashboard/shipments", icon: Truck, tour: "nav-shipments" },
  { label: "NDR & RTO", href: "/dashboard/ndr-rto", icon: PackageX },
  { label: "Labels", href: "/dashboard/labels", icon: Tag, tour: "nav-labels" },
  { label: "Invoices", href: "/dashboard/invoices", icon: Receipt },
  { label: "Manifest", href: "/dashboard/manifests", icon: ClipboardList },
  { label: "Tracking", href: "/dashboard/tracking", icon: Radio },
  { label: "Automation", href: "/dashboard/automation", icon: Workflow },
  { label: "Integrations", href: "/dashboard/integrations", icon: Plug, tour: "nav-integrations" },
  { label: "Billing", href: "/dashboard/billing", icon: CreditCard },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

export const tutorialsNav: NavItem = {
  label: "YouTube Tutorials",
  href: "/dashboard/tutorials",
  icon: YoutubeIcon,
};

export const helpNav: NavItem = {
  label: "Help",
  href: "/contact",
  icon: LifeBuoy,
};

export function isNavItemActive(href: string, pathname: string) {
  return href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
}

const RESOURCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isResourceIdSegment(segment: string) {
  return RESOURCE_ID.test(segment);
}

export type Breadcrumb = {
  label: string;
  href: string;
  resourceId?: boolean;
};

export function breadcrumbs(pathname: string): Breadcrumb[] {
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: Breadcrumb[] = [];
  let href = "";
  for (const segment of segments) {
    href += `/${segment}`;
    if (segment === "dashboard") {
      crumbs.push({ label: "Dashboard", href: "/dashboard" });
      continue;
    }
    if (segment === "tutorials") {
      crumbs.push({ label: "YouTube Tutorials", href });
      continue;
    }
    if (isResourceIdSegment(segment)) {
      crumbs.push({ label: segment, href, resourceId: true });
      continue;
    }
    crumbs.push({
      label:
        segment === "new"
          ? "New"
          : segment === "customer-links"
            ? "Customer links"
            : segment.replace(/-/g, " "),
      href,
    });
  }
  return crumbs;
}
