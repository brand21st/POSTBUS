"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClipboardList, Download, FileCheck2, Lock, PackagePlus, RotateCcw, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type DataTableColumn } from "@/components/dashboard/data-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { manifestOfficeLabel } from "@/lib/dashboard/manifests";
import { formatCurrency, formatDate, formatWeightGrams } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import { useMe } from "@/lib/hooks/use-me";
import { hasPermission } from "@/lib/permissions/rbac";
import type { MemberRole } from "@/types/domain";
import type { ManifestDetail, ManifestEligibleShipment, ManifestLine } from "@/types/api";

type Dialogs = "close" | "handover" | "add" | null;

export default function ManifestDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();
  const me = useMe();
  const canWrite = hasPermission((me.data?.role ?? "VIEWER") as MemberRole, "manifests.write");
  const [dialog, setDialog] = useState<Dialogs>(null);

  const manifest = useQuery({
    queryKey: ["manifest", id],
    queryFn: () => api<ManifestDetail>(`/api/v1/manifests/${id}`),
    enabled: Boolean(id),
    refetchInterval: (current) => (current.state.data?.status === "HANDED_OVER" ? 60_000 : false),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["manifest", id] });
    queryClient.invalidateQueries({ queryKey: ["manifests"] });
    queryClient.invalidateQueries({ queryKey: ["manifest-eligible"] });
  };

  const close = useMutation({
    mutationFn: () => api(`/api/v1/manifests/${id}/close`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Manifest closed. Download the PDF for the pickup counter.");
      setDialog(null);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reopen = useMutation({
    mutationFn: () => api(`/api/v1/manifests/${id}/reopen`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Manifest reopened as a draft.");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (shipmentId: string) => api(`/api/v1/manifests/${id}/shipments/${shipmentId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Shipment removed from the manifest.");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const data = manifest.data;
  const draft = data?.status === "DRAFT";
  const handedOver = data?.status === "HANDED_OVER";

  const columns = useMemo<DataTableColumn<ManifestLine>[]>(() => {
    const base: DataTableColumn<ManifestLine>[] = [
      {
        id: "barcode",
        header: "Barcode",
        cell: (row) => (
          <Link href={`/dashboard/shipments/${row.shipmentId}`} className="font-mono text-sm text-brand hover:underline">
            {row.barcode}
          </Link>
        ),
      },
      { id: "order", header: "Order", cell: (row) => row.orderNumber ?? "—" },
      { id: "consignee", header: "Consignee", fill: true, cell: (row) => row.consignee ?? "—" },
      {
        id: "pincode",
        header: "PIN",
        cell: (row) => (
          <span className="tabular-nums">
            {row.pincode ?? "—"}
            {row.city ? <span className="text-muted"> · {row.city}</span> : null}
          </span>
        ),
      },
      { id: "service", header: "Service", cell: (row) => row.serviceLabel },
      { id: "weight", header: "Weight", cell: (row) => <span className="tabular-nums">{formatWeightGrams(row.weightGrams)}</span> },
      {
        id: "cod",
        header: "COD",
        cell: (row) => (row.codAmount > 0 ? <span className="tabular-nums">{formatCurrency(row.codAmount)}</span> : "—"),
      },
      {
        id: "status",
        header: handedOver ? "India Post scan" : "Status",
        cell: (row) =>
          row.scanned === null ? (
            <StatusBadge value={row.shipmentStatus} />
          ) : row.scanned ? (
            <Badge variant="success">Scanned</Badge>
          ) : (
            <Badge variant="warning">Awaiting scan</Badge>
          ),
      },
    ];
    if (draft && canWrite) {
      base.push({
        id: "remove",
        header: "",
        hug: true,
        cell: (row) => (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={`Remove ${row.barcode}`}
            disabled={remove.isPending}
            onClick={() => remove.mutate(row.shipmentId)}
          >
            <Trash2 className="size-4" />
          </Button>
        ),
      });
    }
    return base;
  }, [draft, handedOver, canWrite, remove]);

  if (manifest.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!data) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Manifest not found"
        description={manifest.error instanceof Error ? manifest.error.message : "It may belong to another workspace."}
        action={
          <Link href="/dashboard/manifests" className={buttonVariants({ variant: "secondary" })}>
            Back to manifests
          </Link>
        }
      />
    );
  }

  const exportHref = (format: string) => `/api/v1/manifests/${id}/export?format=${format}`;
  const totals = data.totals;

  return (
    <div className="space-y-6">
      <Link href="/dashboard/manifests" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" />
        Manifests
      </Link>
      <PageHeader
        title={data.number ?? "Draft manifest"}
        description={`${formatDate(data.date)} · ${manifestOfficeLabel(data)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge value={data.status} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="secondary">
                  <Download className="size-4" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <a href={exportHref("xlsx")}>Excel (.xlsx)</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={exportHref("csv")}>CSV</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={exportHref("pdf")} target="_blank" rel="noreferrer">
                    PDF handover sheet{draft ? " (draft)" : ""}
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {canWrite && draft ? (
              <>
                <Button type="button" variant="secondary" onClick={() => setDialog("add")}>
                  <PackagePlus className="size-4" />
                  Add shipments
                </Button>
                <Button type="button" onClick={() => setDialog("close")} disabled={!data.lines.length}>
                  <Lock className="size-4" />
                  Close manifest
                </Button>
              </>
            ) : null}
            {canWrite && data.status === "CLOSED" ? (
              <>
                <Button type="button" variant="secondary" onClick={() => reopen.mutate()} disabled={reopen.isPending}>
                  <RotateCcw className="size-4" />
                  Reopen
                </Button>
                <Button type="button" onClick={() => setDialog("handover")}>
                  <Truck className="size-4" />
                  Mark handed over
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Articles" value={String(totals.count)} hint={totals.byService.map((s) => `${s.label}: ${s.count}`).join(" · ") || "No articles yet"} />
        <Stat label="Total weight" value={`${(totals.weightGrams / 1000).toFixed(2)} kg`} />
        <Stat label="COD" value={formatCurrency(totals.codAmount)} hint={`${totals.codCount} COD article${totals.codCount === 1 ? "" : "s"}`} />
        {handedOver ? (
          <Stat
            label="Awaiting India Post scan"
            value={String(data.unscannedCount)}
            hint={`Handed over ${formatDate(data.handedOverAt, true)}${data.handedOverTo ? ` to ${data.handedOverTo}` : ""}`}
            warn={data.unscannedCount > 0}
          />
        ) : (
          <Stat
            label={draft ? "Draft" : "Closed"}
            value={draft ? "Open" : formatDate(data.closedAt, true)}
            hint={draft ? "New labelled shipments for this office and date join automatically." : "Locked. Reopen to edit."}
          />
        )}
      </section>

      {handedOver && (data.handoverNotes || data.hasProof) ? (
        <Card>
          <CardHeader className="gap-2">
            <CardDescription>Handover</CardDescription>
            {data.handoverNotes ? <p className="whitespace-pre-wrap text-sm">{data.handoverNotes}</p> : null}
            {data.hasProof ? (
              <a
                href={`/api/v1/manifests/${id}/proof`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
              >
                <FileCheck2 className="size-4" />
                View signed copy
              </a>
            ) : null}
          </CardHeader>
        </Card>
      ) : null}

      <DataTable
        columns={columns}
        data={data.lines}
        emptyTitle="No shipments on this manifest"
        emptyDescription={draft ? "Add labelled shipments, or wait for new bookings to join automatically." : "This manifest is empty."}
        getRowId={(row) => row.shipmentId}
        page={1}
        pageSize={Math.max(data.lines.length, 1)}
        total={data.lines.length}
      />

      <Dialog open={dialog === "close"} onOpenChange={(open) => setDialog(open ? "close" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close this manifest?</DialogTitle>
            <DialogDescription>
              {totals.count} article{totals.count === 1 ? "" : "s"} will be locked and the manifest gets its number. New
              bookings for this office today will start a new draft. You can reopen it until it is handed over.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => close.mutate()} disabled={close.isPending}>
              Close manifest
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HandoverDialog
        open={dialog === "handover"}
        manifestId={id}
        onOpenChange={(open) => setDialog(open ? "handover" : null)}
        onDone={() => {
          setDialog(null);
          refresh();
        }}
      />

      <AddShipmentsDialog
        open={dialog === "add"}
        manifest={data}
        onOpenChange={(open) => setDialog(open ? "add" : null)}
        onDone={() => {
          setDialog(null);
          refresh();
        }}
      />
    </div>
  );
}

function Stat({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <Card className={warn ? "ring-1 ring-amber-300" : undefined}>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
        {hint ? <CardDescription>{hint}</CardDescription> : null}
      </CardHeader>
    </Card>
  );
}

function HandoverDialog({
  open,
  manifestId,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  manifestId: string;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [handedOverTo, setHandedOverTo] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const submit = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.set("handedOverTo", handedOverTo);
      form.set("notes", notes);
      if (file) form.set("proof", file);
      return api(`/api/v1/manifests/${manifestId}/handover`, { method: "POST", body: form });
    },
    onSuccess: () => {
      toast.success("Marked as handed over to India Post.");
      setHandedOverTo("");
      setNotes("");
      setFile(null);
      onDone();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark handed over</DialogTitle>
          <DialogDescription>
            Record the pickup or counter handover. PostBus then flags any article India Post has not scanned within 24 hours.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="handover-to">Received by</Label>
            <Input
              id="handover-to"
              value={handedOverTo}
              maxLength={120}
              placeholder="Postman / counter clerk name"
              onChange={(event) => setHandedOverTo(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="handover-notes">Notes</Label>
            <Textarea
              id="handover-notes"
              value={notes}
              maxLength={1000}
              rows={3}
              placeholder="Bag count, receipt number, remarks"
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="handover-proof">Signed copy (optional)</Label>
            <Input
              id="handover-proof"
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted">PDF, JPG or PNG up to 10 MB.</p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => submit.mutate()} disabled={submit.isPending}>
            Mark handed over
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddShipmentsDialog({
  open,
  manifest,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  manifest: ManifestDetail;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const eligible = useQuery({
    queryKey: ["manifest-eligible"],
    queryFn: () => api<{ items: ManifestEligibleShipment[] }>("/api/v1/manifests/eligible"),
    enabled: open,
  });

  const add = useMutation({
    mutationFn: () =>
      api<{ added: string[]; skipped: number }>(`/api/v1/manifests/${manifest.id}/shipments`, {
        method: "POST",
        body: JSON.stringify({ shipmentIds: [...selected] }),
      }),
    onSuccess: (result) => {
      toast.success(
        `${result.added.length} shipment${result.added.length === 1 ? "" : "s"} added${
          result.skipped ? `, ${result.skipped} skipped (already manifested or not booked)` : ""
        }.`
      );
      setSelected(new Set());
      onDone();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const items = eligible.data?.items ?? [];
  const toggle = (shipmentId: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(shipmentId);
      else next.delete(shipmentId);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add shipments</DialogTitle>
          <DialogDescription>
            Booked shipments from the last 14 days that are not on any manifest. Shipments booked at another office are
            marked.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-border">
          {eligible.isLoading ? (
            <div className="p-4 text-sm text-muted">Loading…</div>
          ) : !items.length ? (
            <div className="p-4 text-sm text-muted">No booked shipments are waiting for a manifest.</div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((item) => {
                const otherOffice = Boolean(manifest.officeId && item.officeId && item.officeId !== manifest.officeId);
                return (
                  <li key={item.shipmentId}>
                    <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-soft">
                      <Checkbox
                        checked={selected.has(item.shipmentId)}
                        onCheckedChange={(value) => toggle(item.shipmentId, value === true)}
                        aria-label={`Select ${item.barcode}`}
                      />
                      <span className="font-mono">{item.barcode}</span>
                      <span className="min-w-0 flex-1 truncate text-muted">
                        {[item.orderNumber, item.consignee, item.pincode].filter(Boolean).join(" · ")}
                      </span>
                      {!item.hasLabel ? <Badge variant="warning">No label</Badge> : null}
                      {otherOffice ? <Badge variant="warning">{item.officeName ?? item.officeId}</Badge> : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => add.mutate()} disabled={!selected.size || add.isPending}>
            Add {selected.size || ""} shipment{selected.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
