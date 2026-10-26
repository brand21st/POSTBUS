"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Download, PackagePlus } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type DataTableColumn } from "@/components/dashboard/data-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MANIFEST_STATUS_LABEL, manifestOfficeLabel } from "@/lib/dashboard/manifests";
import { formatDate } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import { useMe } from "@/lib/hooks/use-me";
import { hasPermission } from "@/lib/permissions/rbac";
import { cn } from "@/lib/utils";
import type { MemberRole } from "@/types/domain";
import type { ManifestListResponse, ManifestRecord } from "@/types/api";

const TABS = [
  { id: "", label: "All" },
  { id: "DRAFT", label: "Drafts" },
  { id: "CLOSED", label: "Closed" },
  { id: "HANDED_OVER", label: "Handed over" },
] as const;

export default function ManifestsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();
  const canWrite = hasPermission((me.data?.role ?? "VIEWER") as MemberRole, "manifests.write");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("");

  const query = useQuery({
    queryKey: ["manifests", page, status],
    queryFn: () =>
      api<ManifestListResponse>(`/api/v1/manifests?page=${page}&pageSize=20${status ? `&status=${status}` : ""}`),
    refetchInterval: 15_000,
  });

  const sweep = useMutation({
    mutationFn: () => api<{ added: number; manifestIds: string[] }>("/api/v1/manifests", { method: "POST" }),
    onSuccess: (result) => {
      toast.success(
        result.added
          ? `${result.added} shipment${result.added === 1 ? "" : "s"} added to today's draft manifest.`
          : "No labelled shipments are waiting for a manifest."
      );
      queryClient.invalidateQueries({ queryKey: ["manifests"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const summary = query.data?.summary;
  const cards = [
    {
      label: "Open drafts",
      value: summary?.openDrafts,
      hint: "Review and close before pickup.",
      onClick: () => setStatus("DRAFT"),
    },
    {
      label: "Waiting for a manifest",
      value: summary?.awaitingManifest,
      hint: "Labelled shipments not on any manifest.",
    },
    {
      label: "Not scanned by India Post",
      value: summary?.unscannedAfterHandover,
      hint: "Handed over over 24 hours ago with no India Post scan.",
      warn: Boolean(summary?.unscannedAfterHandover),
      onClick: () => setStatus("HANDED_OVER"),
    },
  ];

  const columns: DataTableColumn<ManifestRecord>[] = [
    {
      id: "number",
      header: "Manifest",
      cell: (row) => (
        <Link href={`/dashboard/manifests/${row.id}`} className="font-medium text-brand hover:underline">
          {row.number ?? "Draft"}
        </Link>
      ),
    },
    { id: "date", header: "Date", cell: (row) => formatDate(row.date) },
    { id: "office", header: "Booking office", cell: (row) => manifestOfficeLabel(row), fill: true },
    {
      id: "count",
      header: "Shipments",
      cell: (row) => <span className="tabular-nums">{row.shipmentCount}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => <StatusBadge value={row.status} />,
    },
    {
      id: "handover",
      header: "Handover",
      cell: (row) =>
        row.handedOverAt ? (
          <span className="text-sm">
            {formatDate(row.handedOverAt, true)}
            {row.handedOverTo ? <span className="text-muted"> · {row.handedOverTo}</span> : null}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      id: "export",
      header: "",
      hug: true,
      cell: (row) => (
        <a
          href={`/api/v1/manifests/${row.id}/export?format=xlsx`}
          className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          <Download className="size-3.5" />
          Excel
        </a>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Manifests"
        description="Labelled shipments join today's draft for their India Post booking office. Close the draft before pickup, then mark it handed over."
        actions={
          canWrite ? (
            <Button type="button" onClick={() => sweep.mutate()} disabled={sweep.isPending}>
              <PackagePlus className="size-4" />
              Add ready shipments
            </Button>
          ) : null
        }
      />

      <section className="grid gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <Card
            key={card.label}
            role={card.onClick ? "button" : undefined}
            tabIndex={card.onClick ? 0 : undefined}
            className={cn(card.onClick && "cursor-pointer", card.warn && "ring-1 ring-amber-300")}
            onClick={card.onClick}
            onKeyDown={(event) => {
              if (card.onClick && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                card.onClick();
              }
            }}
          >
            <CardHeader>
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">
                {query.isLoading ? "…" : query.isError ? "—" : card.value ?? 0}
              </CardTitle>
              <CardDescription>{card.hint}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Manifest status">
        {TABS.map((tab) => (
          <Button
            key={tab.id || "all"}
            type="button"
            role="tab"
            aria-selected={status === tab.id}
            variant={status === tab.id ? "primary" : "secondary"}
            size="sm"
            onClick={() => {
              setStatus(tab.id);
              setPage(1);
            }}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        loading={query.isLoading}
        error={query.error instanceof Error ? query.error : null}
        emptyTitle={status ? `No ${MANIFEST_STATUS_LABEL[status]?.toLowerCase()} manifests` : "No manifests yet"}
        emptyDescription="When India Post books and labels a shipment, it joins today's draft manifest automatically."
        emptyAction={
          <div className="flex items-center gap-2 text-muted">
            <ClipboardList className="size-4" />
            Waiting for labelled shipments.
          </div>
        }
        page={query.data?.page ?? page}
        pageSize={query.data?.pageSize ?? 20}
        total={query.data?.total ?? 0}
        onPageChange={setPage}
        getRowId={(row) => row.id}
        onRowClick={(row) => router.push(`/dashboard/manifests/${row.id}`)}
      />
    </div>
  );
}
