"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type DataTableColumn } from "@/components/dashboard/data-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { asPaginated } from "@/lib/dashboard/records";
import { formatDate } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import type { ManifestRecord, Paginated } from "@/types/api";

export default function ManifestsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ["manifests", page],
    queryFn: () => api<Paginated<ManifestRecord>>(`/api/v1/manifests?page=${page}&pageSize=20`),
  });

  const list = asPaginated<ManifestRecord>(query.data, ["manifests", "items"]);

  const generate = useMutation({
    mutationFn: () => api("/api/v1/manifests", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => {
      toast.success("Manifest generation queued.");
      queryClient.invalidateQueries({ queryKey: ["manifests"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const columns: DataTableColumn<ManifestRecord>[] = [
    { id: "name", header: "Manifest", cell: (row) => row.name ?? row.id.slice(0, 8) },
    { id: "status", header: "Status", cell: (row) => <StatusBadge value={row.status} /> },
    {
      id: "count",
      header: "Shipments",
      cell: (row) => String(row.shipmentCount ?? row.shipment_count ?? 0),
    },
    {
      id: "created",
      header: "Created",
      cell: (row) => formatDate(row.createdAt ?? row.created_at, true),
    },
    {
      id: "actions",
      header: "File",
      cell: (row) => {
        const href = row.fileUrl ?? row.file_url;
        if (!href) return <span className="text-muted">Not ready</span>;
        return (
          <a href={href} className="text-sm font-medium text-brand hover:underline">
            Download
          </a>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Manifests"
        description="Generate operational pickup manifests from booked shipments."
        actions={
          <Button type="button" onClick={() => generate.mutate()} disabled={generate.isPending}>
            <Plus className="size-4" />
            Generate manifest
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={list.items}
        loading={query.isLoading}
        error={query.error instanceof Error ? query.error : null}
        emptyTitle="No manifests yet"
        emptyDescription="Generate a manifest after shipments are booked. The file is stored only when the job succeeds."
        emptyAction={
          <div className="flex items-center gap-2 text-muted">
            <ClipboardList className="size-4" />
            Waiting for booked shipments.
          </div>
        }
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
        onPageChange={setPage}
        getRowId={(row) => row.id}
      />
    </div>
  );
}
