"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, ChevronRight, Menu, Search } from "lucide-react";
import { toast } from "sonner";
import { CommandSearch } from "@/components/dashboard/command-search";
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
import { breadcrumbs } from "@/lib/dashboard/nav";
import { asList } from "@/lib/dashboard/records";
import { formatRelative, initials } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import { membershipsFromMe } from "@/lib/hooks/use-me";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { MeResponse, NotificationRecord } from "@/types/api";

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
  const [searchOpen, setSearchOpen] = useState(false);
  const workspaces = membershipsFromMe(me);

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

  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<NotificationRecord[] | { items: NotificationRecord[] }>("/api/v1/notifications"),
  });

  const items = asList<NotificationRecord>(notifications.data);
  const unread = items.filter((item) => !item.readAt && !item.read_at).length;

  const switchWorkspace = useMutation({
    mutationFn: (organizationId: string) =>
      api("/api/v1/organizations/switch", {
        method: "POST",
        body: JSON.stringify({ organizationId }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      toast.success("Workspace switched");
      router.refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

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
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background px-4 lg:px-6">
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
              className={cn(
                "truncate capitalize hover:text-brand",
                index === crumbs.length - 1 ? "font-medium text-ink" : "text-muted"
              )}
            >
              {crumb.label}
            </Link>
          </span>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-1.5">
        <Button
          type="button"
          variant="secondary"
          className="hidden h-10 w-64 justify-start text-muted md:inline-flex"
          onClick={() => setSearchOpen(true)}
        >
          <Search className="size-4" />
          Search
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="secondary" size="sm" className="max-w-[180px]">
              <span className="truncate">{me?.organization?.name ?? "Workspace"}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {workspaces.map((workspace) => (
              <DropdownMenuItem
                key={workspace.id}
                onClick={() => switchWorkspace.mutate(workspace.id)}
              >
                <span className="flex-1 truncate">{workspace.name}</span>
                {workspace.id === me?.organization?.id ? <Check className="size-4 text-brand" /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/onboarding")}>
              Create workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label="Profile">
              <span className="flex size-8 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">
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
