import {
  LayoutDashboard,
  Building2,
  Repeat,
  Layers,
  CreditCard,
  TrendingUp,
  Gauge,
  Landmark,
  Timer,
  ScrollText,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type AdminNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export const adminNav: AdminNavItem[] = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { label: "Accounts", href: "/admin/accounts", icon: Building2 },
  { label: "Subscriptions", href: "/admin/subscriptions", icon: Repeat },
  { label: "Plans", href: "/admin/plans", icon: Layers },
  { label: "Payments", href: "/admin/payments", icon: CreditCard },
  { label: "Revenue", href: "/admin/revenue", icon: TrendingUp },
  { label: "Usage", href: "/admin/usage", icon: Gauge },
  { label: "Razorpay", href: "/admin/razorpay", icon: Landmark },
  { label: "Trial Settings", href: "/admin/trial", icon: Timer },
  { label: "Audit Logs", href: "/admin/audit", icon: ScrollText },
  { label: "System Settings", href: "/admin/settings", icon: Settings },
];
