"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AdminSidebar } from "@/components/admin/sidebar";
import { AdminAccountMenu } from "@/components/admin/account-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, isConfirmedSessionLoss, isTransientApiAuthError } from "@/lib/hooks/use-api";
import { useEffect } from "react";

export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const query = useQuery({
    queryKey: ["admin", "session"],
    queryFn: () => api<{ totals?: Record<string, number> }>("/api/admin/overview"),
    retry: (failureCount, error) => {
      if (isConfirmedSessionLoss(error)) return false;
      if (isTransientApiAuthError(error)) return failureCount < 2;
      return false;
    },
    retryDelay: (failureCount) => Math.min(1000 * 2 ** failureCount, 4000),
  });

  useEffect(() => {
    if (isConfirmedSessionLoss(query.error)) {
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

  if (isTransientApiAuthError(query.error)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-surface px-6">
        <p className="text-sm text-muted">Connection issue. Retrying your session without signing you out…</p>
        {query.isFetching ? null : (
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1 text-sm text-ink"
            onClick={() => void query.refetch()}
          >
            Retry
          </button>
        )}
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
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-card px-3 md:hidden">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            data-admin-nav-trigger
            className="flex size-10 items-center justify-center rounded-lg text-foreground hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <Menu className="size-5" />
          </button>
          <span className="min-w-0 flex-1 truncate font-semibold text-ink">PostBus Admin</span>
          <AdminAccountMenu compact />
        </header>
        <main className="min-w-0 flex-1 px-4 py-5 sm:px-5 lg:px-6 lg:py-6 xl:px-8">{children}</main>
      </div>
      <DialogPrimitive.Root open={navOpen} onOpenChange={setNavOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="drawer-overlay fixed inset-0 z-50 bg-black/40 md:hidden" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              document.querySelector<HTMLElement>("[data-admin-nav-trigger]")?.focus();
            }}
            className="drawer-panel fixed inset-y-0 left-0 z-50 w-[260px] max-w-[85vw] shadow-[0_12px_40px_rgb(9_9_11/0.18)] focus:outline-none md:hidden"
          >
            <DialogPrimitive.Title className="sr-only">Admin navigation</DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="Close menu"
              className="absolute right-2 top-2.5 z-10 flex size-10 items-center justify-center rounded-lg text-muted hover:bg-surface-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
            <AdminSidebar onNavigate={() => setNavOpen(false)} className="w-full" />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}
