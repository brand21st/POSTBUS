"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/format";
import { useMe } from "@/lib/hooks/use-me";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export function AdminAccountMenu({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const me = useMe();
  const name = me.data?.user.fullName ?? "Account";
  const email = me.data?.user.email ?? "Super Admin";

  async function logOut() {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // still leave admin
    }
    window.location.assign("/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={cn(
            "h-auto w-full justify-start gap-3 rounded-xl px-3 py-2 text-left hover:bg-surface-soft",
            compact && "w-auto justify-center px-2"
          )}
          aria-label="Account"
        >
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-rose-100 text-xs font-semibold text-brand-dark"
          >
            {initials(name === "Account" ? email : name)}
          </span>
          {compact ? null : (
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink">{name}</span>
              <span className="block truncate text-xs text-muted">{email}</span>
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? "end" : "start"} className="w-56" side={compact ? "bottom" : "top"}>
        <DropdownMenuLabel>
          <div className="truncate">{name}</div>
          <div className="truncate text-xs font-normal text-muted">{email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void logOut()}>
          <LogOut className="size-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
