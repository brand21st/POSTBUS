import {
  LayoutDashboard,
  ShoppingBag,
  Truck,
  Tag,
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
  { label: "Orders", href: "/dashboard/orders", icon: ShoppingBag },
  { label: "Shipments", href: "/dashboard/shipments", icon: Truck },
  { label: "Labels", href: "/dashboard/labels", icon: Tag },
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

export function pageTitleFromPath(pathname: string) {
  if (pathname === "/dashboard") return "Dashboard";
  const match = sidebarNav.find(
    (item) => item.href !== "/dashboard" && pathname.startsWith(item.href)
  );
  if (match) return match.label;
  if (pathname.startsWith("/dashboard/orders/new")) return "Add Order";
  return "Dashboard";
}

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
