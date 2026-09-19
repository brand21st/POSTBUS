"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Printer, Tag } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type DataTableColumn } from "@/components/dashboard/data-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { asPaginated } from "@/lib/dashboard/records";
import { formatDate } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import type { LabelRecord, Paginated } from "@/types/api";

function fileUrl(label: LabelRecord) {
  return label.fileUrl ?? label.file_url ?? `/api/v1/labels/${label.id}/download`;
}

export default function LabelsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);

  const query = useQuery({
    queryKey: ["labels", page],
    queryFn: () => api<Paginated<LabelRecord>>(`/api/v1/labels?page=${page}&pageSize=20`),
  });

  const list = asPaginated<LabelRecord>(query.data, ["labels", "items"]);

  const bulk = useMutation({
    mutationFn: (ids: string[]) =>
      api<{ url?: string }>("/api/v1/labels/bulk-download", {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: (data) => {
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      toast.success("Bulk download is ready.");
      queryClient.invalidateQueries({ queryKey: ["labels"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const columns: DataTableColumn<LabelRecord>[] = [
    {
      id: "label",
      header: "Label",
      cell: (row) => row.orderNumber ?? row.order_number ?? row.id.slice(0, 8),
    },
    {
      id: "tracking",
      header: "Tracking",
      cell: (row) => row.trackingNumber ?? row.tracking_number ?? "—",
    },
    { id: "status", header: "Status", cell: (row) => <StatusBadge value={row.status} /> },
    {
      id: "created",
      header: "Created",
      cell: (row) => formatDate(row.createdAt ?? row.created_at, true),
    },
    {
      id: "actions",
      header: "Actions",
      cell: (row) => {
        const href = fileUrl(row);
        const ready = (row.status ?? "").toUpperCase() === "READY" && Boolean(row.fileUrl || row.file_url || row.id);
        return (
          <div className="flex gap-2" onClick={(event) => event.stopPropagation()}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!ready}
              onClick={() => window.open(href, "_blank", "noopener,noreferrer")}
            >
              Preview
            </Button>
            <a href={href} className={!ready ? "pointer-events-none opacity-50" : undefined}>
              <Button type="button" variant="secondary" size="sm" disabled={!ready}>
                <Download className="size-4" />
                Download
              </Button>
            </a>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!ready}
              onClick={() => window.open(href, "_blank", "noopener,noreferrer")}
            >
              <Printer className="size-4" />
              Print
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Labels"
        description="Preview, download, or print stored label PDFs. Empty until a booking job generates one."
        actions={
          <Button
            type="button"
            variant="secondary"
            disabled={selected.length === 0 || bulk.isPending}
            onClick={() => bulk.mutate(selected)}
          >
            <Download className="size-4" />
            Bulk download
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={list.items}
        loading={query.isLoading}
        error={query.error instanceof Error ? query.error : null}
        emptyTitle="No labels yet"
        emptyDescription="Labels appear here after a shipment is booked and the label job succeeds."
        emptyAction={
          <div className="flex items-center gap-2 text-muted">
            <Tag className="size-4" />
            Connect India Post to generate labels.
          </div>
        }
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
        onPageChange={setPage}
        selectable
        onSelectionChange={setSelected}
        getRowId={(row) => row.id}
      />
    </div>
  );
}
