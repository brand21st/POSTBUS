import {
  LayoutDashboard,
  BarChart3,
  ShoppingBag,
  Truck,
  Tag,
  Receipt,
  ClipboardList,
  Radio,
  Workflow,
  Plug,
  CreditCard,
  Settings,
  LifeBuoy,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export const sidebarNav: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Analytics", href: "/dashboard/analytics", icon: BarChart3 },
  { label: "Orders", href: "/dashboard/orders", icon: ShoppingBag },
  { label: "Shipments", href: "/dashboard/shipments", icon: Truck },
  { label: "Labels", href: "/dashboard/labels", icon: Tag },
  { label: "Invoices", href: "/dashboard/invoices", icon: Receipt },
  { label: "Manifest", href: "/dashboard/manifests", icon: ClipboardList },
  { label: "Tracking", href: "/dashboard/tracking", icon: Radio },
  { label: "Automation", href: "/dashboard/automation", icon: Workflow },
  { label: "Integrations", href: "/dashboard/integrations", icon: Plug },
  { label: "Billing", href: "/dashboard/billing", icon: CreditCard },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

export const helpNav: NavItem = {
  label: "Help",
  href: "/contact",
  icon: LifeBuoy,
};

export function breadcrumbs(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: { label: string; href: string }[] = [];
  let href = "";
  for (const segment of segments) {
    href += `/${segment}`;
    if (segment === "dashboard") {
      crumbs.push({ label: "Dashboard", href: "/dashboard" });
      continue;
    }
    crumbs.push({
      label: segment === "new" ? "New" : segment.replace(/-/g, " "),
      href,
    });
  }
  return crumbs;
}
