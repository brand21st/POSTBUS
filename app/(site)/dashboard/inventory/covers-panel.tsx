"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Copy, ExternalLink, Plus, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/hooks/use-api";
import { coverLifecycle, type CoverRecord } from "@/modules/storefront/cover-model";
import { cn } from "@/lib/utils";

type Analytics = {
  days: number;
  note: string;
  covers: Record<string, { impressions: number; clicks: number; desktop: number; mobile: number }>;
};

const LIFE_LABEL: Record<string, string> = {
  live: "Live",
  scheduled: "Scheduled",
  expired: "Expired",
  draft: "Draft",
  archived: "Archived",
};

export function InventoryCovers({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const client = useQueryClient();
  const covers = useQuery({
    queryKey: ["inventory-covers"],
    queryFn: () => api<CoverRecord[]>("/api/v1/inventory/covers"),
  });
  const analytics = useQuery({
    queryKey: ["inventory-covers-analytics"],
    queryFn: () => api<Analytics>("/api/v1/inventory/covers/analytics?days=7"),
  });
  const storefront = useQuery({
    queryKey: ["inventory-storefront"],
    queryFn: () => api<{ storeUrl?: string }>("/api/v1/inventory/storefront"),
  });

  async function patch(id: string, body: Record<string, unknown>) {
    try {
      const next = await api<CoverRecord>(`/api/v1/inventory/covers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      client.setQueryData(["inventory-covers"], (current: CoverRecord[] | undefined) =>
        (current ?? []).map((cover) => (cover.id === id ? next : cover))
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update cover.");
    }
  }

  const items = covers.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button size="xs" disabled={!canWrite} onClick={() => router.push("/dashboard/inventory/covers/new")}>
          <Sparkles className="size-3.5" /> Create AI cover
        </Button>
        <Button size="xs" variant="secondary" disabled={!canWrite} onClick={() => router.push("/dashboard/inventory/covers/new?mode=upload")}>
          <Upload className="size-3.5" /> Upload & enhance
        </Button>
        <Button size="xs" variant="secondary" disabled={!canWrite} onClick={() => router.push("/dashboard/inventory/covers/new?preset=festival")}>
          Festival templates
        </Button>
        <Button size="xs" variant="secondary" disabled={!canWrite} onClick={() => router.push("/dashboard/inventory/covers/new?type=promotional")}>
          Create offer banner
        </Button>
        {storefront.data?.storeUrl ? (
          <a
            href={storefront.data.storeUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ size: "xs", variant: "ghost" })}
          >
            <ExternalLink className="size-3.5" /> Preview store
          </a>
        ) : null}
      </div>
      <p className="text-[11px] text-muted">{analytics.data?.note ?? "Engagement only — impressions and clicks are not conversion or sales."}</p>
      {covers.isPending ? <p className="text-sm text-muted">Loading covers…</p> : null}
      {covers.isError ? (
        <p className="text-sm text-rose-800">
          {covers.error instanceof Error ? covers.error.message : "Could not load covers. Apply the Cover Studio migration first."}
        </p>
      ) : null}
      {!covers.isPending && !items.length ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm font-semibold">No covers yet</p>
          <p className="mt-1 text-xs text-muted">Generate an AI cover or upload a photo. Originals stay in the studio.</p>
          <Button className="mt-3" size="xs" disabled={!canWrite} onClick={() => router.push("/dashboard/inventory/covers/new")}>
            <Plus className="size-3.5" /> New cover
          </Button>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((cover, index) => {
          const life = coverLifecycle(cover);
          const stats = analytics.data?.covers[cover.id];
          const ctr = stats && stats.impressions ? Math.round((stats.clicks / stats.impressions) * 1000) / 10 : 0;
          return (
            <article key={cover.id} className="overflow-hidden rounded-xl border border-border bg-card">
              <Link href={`/dashboard/inventory/covers/${cover.id}`} className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cover.imageUrl} alt="" className="h-36 w-full object-cover" />
              </Link>
              <div className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{cover.name || cover.title || "Untitled cover"}</p>
                    <p className="text-[11px] text-muted">{cover.coverType.replaceAll("_", " ")}</p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      life === "live" && "bg-emerald-50 text-emerald-800",
                      life === "scheduled" && "bg-amber-50 text-amber-800",
                      life === "draft" && "bg-zinc-100 text-zinc-700",
                      (life === "expired" || life === "archived") && "bg-rose-50 text-rose-800"
                    )}
                  >
                    {LIFE_LABEL[life]}
                  </span>
                </div>
                <p className="text-[11px] text-muted">
                  7d · {stats?.impressions ?? 0} views · {stats?.clicks ?? 0} clicks
                  {stats?.impressions ? ` · ${ctr}% CTR` : ""}
                </p>
                <div className="flex items-center justify-between">
                  <Switch
                    aria-label={`Show ${cover.name || "cover"}`}
                    disabled={!canWrite}
                    checked={cover.enabled && cover.status === "PUBLISHED"}
                    onCheckedChange={(enabled) => void patch(cover.id, { enabled, status: enabled ? "PUBLISHED" : "DRAFT" })}
                  />
                  <div className="flex gap-1">
                    <Button size="icon-xs" variant="ghost" disabled={!canWrite || index === 0} aria-label="Move up" onClick={() => void patch(cover.id, { sortOrder: index - 1 })}>
                      <ArrowUp />
                    </Button>
                    <Button size="icon-xs" variant="ghost" disabled={!canWrite || index === items.length - 1} aria-label="Move down" onClick={() => void patch(cover.id, { sortOrder: index + 1 })}>
                      <ArrowDown />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      disabled={!canWrite}
                      aria-label="Duplicate"
                      onClick={() =>
                        api<CoverRecord>(`/api/v1/inventory/covers/${cover.id}/duplicate`, { method: "POST" })
                          .then(() => client.invalidateQueries({ queryKey: ["inventory-covers"] }))
                          .catch((error: Error) => toast.error(error.message))
                      }
                    >
                      <Copy />
                    </Button>
                    <Link href={`/dashboard/inventory/covers/${cover.id}`} className={buttonVariants({ size: "xs", variant: "secondary" })}>
                      Edit
                    </Link>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
