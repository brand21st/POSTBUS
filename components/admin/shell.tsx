"use client";

import { type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AdminSidebar } from "@/components/admin/sidebar";
import { AdminAccountMenu } from "@/components/admin/account-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/hooks/use-api";
import { useEffect } from "react";

export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const query = useQuery({
    queryKey: ["admin", "session"],
    queryFn: () => api<{ totals?: Record<string, number> }>("/api/admin/overview"),
    retry: false,
  });

  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [pathname, query.error, router]);

  if (query.isLoading) {
    return (
      <div className="flex min-h-screen bg-surface">
        <div className="hidden w-[240px] border-r border-border bg-card p-4 md:block">
          <Skeleton className="h-8 w-32" />
        </div>
        <div className="flex-1 p-8">
          <Skeleton className="h-10 w-64" />
        </div>
      </div>
    );
  }

  if (query.error instanceof ApiError && query.error.status === 403) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface px-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold text-ink">Not found</h1>
          <p className="mt-2 text-sm text-muted">This page does not exist.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <div className="hidden md:block">
        <AdminSidebar />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border bg-card px-4 md:hidden">
          <span className="font-semibold text-ink">PostBus Admin</span>
          <AdminAccountMenu compact />
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
