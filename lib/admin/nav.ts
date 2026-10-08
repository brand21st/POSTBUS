import {
  LayoutDashboard,
  Building2,
  Repeat,
  Layers,
  Sparkles,
  CreditCard,
  TrendingUp,
  Gauge,
  Landmark,
  Timer,
  Clapperboard,
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
  { label: "AI Credits", href: "/admin/ai-credits", icon: Sparkles },
  { label: "Payments", href: "/admin/payments", icon: CreditCard },
  { label: "Revenue", href: "/admin/revenue", icon: TrendingUp },
  { label: "Usage", href: "/admin/usage", icon: Gauge },
  { label: "Razorpay", href: "/admin/razorpay", icon: Landmark },
  { label: "Trial Settings", href: "/admin/trial", icon: Timer },
  { label: "Tutorials", href: "/admin/tutorials", icon: Clapperboard },
  { label: "Audit Logs", href: "/admin/audit", icon: ScrollText },
  { label: "System Settings", href: "/admin/settings", icon: Settings },
];
