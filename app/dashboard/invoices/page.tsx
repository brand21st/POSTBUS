"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Download, Eye, Plus, Printer, Search, Settings2, X } from "lucide-react";
import { toast } from "sonner";
import { InvoiceActions } from "@/components/invoices/invoice-actions";
import { DataTable, type DataTableColumn } from "@/components/dashboard/data-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { asPaginated, customerName } from "@/lib/dashboard/records";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  DOCUMENT_TYPE_OPTIONS,
  PAYMENT_OPTIONS,
  SALES_STATUS_OPTIONS,
  SOURCE_OPTIONS,
  paymentBadge,
  rowGstPaise,
  salesInvoiceFilename,
  salesInvoiceHasPdf,
  salesStatusBadge,
  shippingStatusBadge,
  type InvoiceBadgeTone,
  type InvoiceOption,
} from "@/lib/invoices/labels";
import { downloadInvoicePdf, openInvoicePdf, printInvoicePdf } from "@/lib/invoices/preview";
import { api } from "@/lib/hooks/use-api";
import { usePlanEntitlements } from "@/lib/hooks/use-plan-entitlements";
import { cn } from "@/lib/utils";
import { FEATURE } from "@/modules/billing/entitlements";
import type { SalesInvoiceSummary } from "@/modules/sales-invoices/list";
import type { InvoiceRecord, Paginated } from "@/types/api";

type SalesInvoiceRow = {
  id: string;
  invoiceNumber: string | null;
  customerName: string;
  orderNumber: string;
  invoiceDate: string | null;
  status: string;
  paymentStatus: string;
  source: string;
  documentKind: "SALES" | "CREDIT_NOTE";
  documentType: string;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  utgstPaise: number;
  igstPaise: number;
  cessPaise: number;
  grandTotalPaise: number;
  currency: string;
};

type Filters = {
  status: string;
  payment: string;
  source: string;
  documentType: string;
  from: string;
  to: string;
};

const NO_FILTERS: Filters = { status: "", payment: "", source: "", documentType: "", from: "", to: "" };

function rupees(paise: number, currency = "INR") {
  return formatCurrency(paise / 100, currency);
}

function pdfError(error: Error) {
  toast.error(error.message || "Could not open the PDF. Try again.");
}

export default function InvoicesPage() {
  const entitlements = usePlanEntitlements();
  const invoicesAllowed = entitlements.allows(FEATURE.invoices);
  const checking = entitlements.loading;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Invoices"
        description="GST invoices for your orders, and shipping documents from India Post bookings."
        actions={
          <>
            <Link href="/dashboard/invoices/customize" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                <Settings2 className="size-4" />
                Invoice settings
              </Link>
            <NewInvoiceButton allowed={invoicesAllowed} checking={checking} />
          </>
        }
      />
      <Tabs defaultValue="shipping">
        <TabsList>
          <TabsTrigger value="shipping">Shipping documents</TabsTrigger>
          <TabsTrigger value="sales">Sales invoices</TabsTrigger>
        </TabsList>
        <TabsContent value="shipping">
          <ShippingTab allowed={invoicesAllowed} checking={checking} />
        </TabsContent>
        <TabsContent value="sales">
          <SalesTab allowed={invoicesAllowed} checking={checking} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function NewInvoiceButton({ allowed, checking }: { allowed: boolean; checking?: boolean }) {
  const content = (
    <>
      <Plus className="size-4" />
      New invoice
    </>
  );
  if (!allowed) {
    return (
      <Button type="button" size="sm" disabled title={checking ? undefined : "Invoices are not on your plan"}>
        {content}
      </Button>
    );
  }
  return (
    <Link href="/dashboard/invoices/new" className={buttonVariants({ size: "sm" })}>{content}</Link>
  );
}

function useDebounced<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function SalesTab({ allowed, checking }: { allowed: boolean; checking: boolean }) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput.trim(), 300);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const filtered = Boolean(search) || Object.values(filters).some(Boolean);
  const dateRangeInvalid = Boolean(filters.from && filters.to && filters.from > filters.to);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const setFilter = (key: keyof Filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  const clearFilters = () => {
    setFilters(NO_FILTERS);
    setSearchInput("");
    setPage(1);
  };

  const query = useQuery({
    queryKey: ["sales-invoices", page, search, filters],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (search) params.set("search", search);
      for (const [key, value] of Object.entries(filters)) {
        if (value) params.set(key, value);
      }
      return api<Paginated<SalesInvoiceRow>>(`/api/v1/sales-invoices?${params}`);
    },
    placeholderData: keepPreviousData,
    enabled: allowed && !dateRangeInvalid,
  });
  const summary = useQuery({
    queryKey: ["sales-invoices-summary"],
    queryFn: () => api<SalesInvoiceSummary>("/api/v1/sales-invoices/summary"),
    enabled: allowed,
  });
  const list = asPaginated<SalesInvoiceRow>(query.data);
  const open = (row: SalesInvoiceRow) => router.push(`/dashboard/invoices/${row.id}`);

  const columns: DataTableColumn<SalesInvoiceRow>[] = [
    {
      id: "number",
      header: "Invoice no.",
      cell: (row) => (
        <div className="flex flex-col items-start gap-1">
          <Link
            className={cn("whitespace-nowrap font-medium tabular-nums hover:underline", !row.invoiceNumber && "text-muted")}
            href={`/dashboard/invoices/${row.id}`}
            onClick={(event) => event.stopPropagation()}
          >
            {row.invoiceNumber || "Not issued"}
          </Link>
          {row.documentKind === "CREDIT_NOTE" ? <Badge variant="outline">Credit note</Badge> : null}
        </div>
      ),
    },
    { id: "customer", header: "Customer", cell: (row) => row.customerName || "—" },
    { id: "order", header: "Order", cell: (row) => <span className="tabular-nums">{row.orderNumber || "—"}</span> },
    { id: "date", header: "Invoice date", cell: (row) => (row.invoiceDate ? formatDate(row.invoiceDate) : <span className="text-muted">—</span>) },
    { id: "taxable", header: "Taxable value", className: "text-right tabular-nums", cell: (row) => rupees(row.taxablePaise, row.currency) },
    { id: "gst", header: "GST", className: "text-right tabular-nums", cell: (row) => rupees(rowGstPaise(row), row.currency) },
    { id: "total", header: "Total", className: "text-right font-medium tabular-nums", cell: (row) => rupees(row.grandTotalPaise, row.currency) },
    {
      id: "payment",
      header: "Payment",
      cell: (row) => (row.status === "CANCELLED" ? <span className="text-muted">—</span> : <ToneBadge {...paymentBadge(row.paymentStatus)} />),
    },
    { id: "status", header: "Status", cell: (row) => <ToneBadge {...salesStatusBadge(row.status)} /> },
    {
      id: "actions",
      header: "",
      hug: true,
      width: 128,
      cell: (row) => <SalesRowActions row={row} />,
    },
  ];

  const cards = summary.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Issued value"
          value={cards ? rupees(cards.valuePaise) : null}
          hint={cards ? `${cards.issued} issued${cards.creditNotes ? `, less ${cards.creditNotes} credit ${cards.creditNotes === 1 ? "note" : "notes"}` : ""}` : null}
          error={summary.isError}
        />
        <StatCard label="GST on issued" value={cards ? rupees(cards.gstPaise) : null} hint="CGST, SGST, IGST and cess" error={summary.isError} />
        <StatCard
          label="Drafts"
          value={cards ? String(cards.drafts) : null}
          hint="Not issued yet"
          error={summary.isError}
          active={filters.status === "DRAFT"}
          onClick={cards?.drafts ? () => setFilter("status", filters.status === "DRAFT" ? "" : "DRAFT") : undefined}
        />
        <StatCard
          label="Needs review"
          value={cards ? String(cards.review) : null}
          hint="Fix tax details before issuing"
          tone={cards?.review ? "warning" : undefined}
          error={summary.isError}
          active={filters.status === "REVIEW"}
          onClick={cards?.review ? () => setFilter("status", filters.status === "REVIEW" ? "" : "REVIEW") : undefined}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <div className="relative col-span-2 min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            className="h-10 pl-9"
            value={searchInput}
            placeholder="Invoice no., customer or order"
            aria-label="Search invoices"
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
        <FilterSelect label="Status" value={filters.status} options={SALES_STATUS_OPTIONS} onChange={(value) => setFilter("status", value)} />
        <FilterSelect label="Payment" value={filters.payment} options={PAYMENT_OPTIONS} onChange={(value) => setFilter("payment", value)} />
        <FilterSelect label="Source" value={filters.source} options={SOURCE_OPTIONS} onChange={(value) => setFilter("source", value)} />
        <FilterSelect label="Type" value={filters.documentType} options={DOCUMENT_TYPE_OPTIONS} onChange={(value) => setFilter("documentType", value)} />
        <DateRangeFilter from={filters.from} to={filters.to} onChange={setFilter} />
        {filtered ? (
          <Button type="button" variant="ghost" size="sm" className="col-span-2 h-10" onClick={clearFilters}>
            <X className="size-4" />
            Clear
          </Button>
        ) : null}
      </div>
      {dateRangeInvalid ? <p className="text-sm text-error">The start date must be on or before the end date.</p> : null}

      {query.isError ? (
        <EmptyState
          icon={AlertCircle}
          title="Could not load invoices"
          description={query.error instanceof Error && query.error.message ? query.error.message : "Check your connection and try again."}
          action={
            <Button type="button" variant="secondary" size="sm" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={list.items}
          getRowId={(row) => row.id}
          onRowClick={open}
          loading={checking || query.isLoading}
          fetching={query.isFetching && !query.isLoading}
          emptyTitle={filtered ? "No invoices match these filters" : "No sales invoices yet"}
          emptyDescription={
            filtered
              ? "Try a different search or clear the filters."
              : "Create a GST invoice from any order. Drafts stay editable until you issue them."
          }
          emptyAction={
            filtered ? (
              <Button type="button" variant="secondary" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : allowed ? (
              <NewInvoiceButton allowed />
            ) : null
          }
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}

function SalesRowActions({ row }: { row: SalesInvoiceRow }) {
  if (!salesInvoiceHasPdf(row.status)) {
    return (
      <Link
        href={`/dashboard/invoices/${row.id}`}
        className={buttonVariants({ variant: "secondary", size: "xs" })}
        onClick={(event) => event.stopPropagation()}
      >
        {row.status === "REVIEW" ? "Review" : "Edit draft"}
      </Link>
    );
  }
  const filename = salesInvoiceFilename(row.invoiceNumber, row.id);
  return (
    <div
      className="inline-flex divide-x divide-border overflow-hidden rounded-lg border border-border bg-card"
      onClick={(event) => event.stopPropagation()}
    >
      <IconAction label="View PDF" onClick={() => openInvoicePdf(row.id, "sales").catch(pdfError)}>
        <Eye className="size-3.5" />
      </IconAction>
      <IconAction label="Download PDF" onClick={() => downloadInvoicePdf(row.id, filename, "sales").catch(pdfError)}>
        <Download className="size-3.5" />
      </IconAction>
      <IconAction label="Print" onClick={() => printInvoicePdf(row.id, "sales").catch(pdfError)}>
        <Printer className="size-3.5" />
      </IconAction>
    </div>
  );
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="grid size-8 place-items-center text-muted transition-colors hover:bg-surface-soft hover:text-foreground"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ToneBadge({ label, tone }: { label: string; tone: InvoiceBadgeTone }) {
  return <Badge variant={tone}>{label}</Badge>;
}

function StatCard({
  label,
  value,
  hint,
  tone,
  error,
  active,
  onClick,
}: {
  label: string;
  value: string | null;
  hint?: string | null;
  tone?: "warning";
  error?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <p className="text-xs font-medium text-muted">{label}</p>
      {error ? (
        <p className="mt-1 text-lg font-semibold text-muted">—</p>
      ) : value === null ? (
        <Skeleton className="mt-1.5 h-6 w-24" />
      ) : (
        <p className={cn("mt-1 text-lg font-semibold tabular-nums", tone === "warning" && "text-amber-700 dark:text-amber-300")}>{value}</p>
      )}
      {hint ? <p className="mt-0.5 truncate text-xs text-muted">{hint}</p> : null}
    </>
  );
  if (onClick) {
    return (
      <Card
        role="button"
        tabIndex={0}
        aria-pressed={active}
        className={cn("cursor-pointer p-3 text-left transition-colors hover:border-zinc-300", active && "border-brand ring-1 ring-brand/30")}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onClick();
          }
        }}
      >
        {body}
      </Card>
    );
  }
  return <Card className="p-3">{body}</Card>;
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: InvoiceOption[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value || "all"} onValueChange={(next) => onChange(next === "all" ? "" : next)}>
      <SelectTrigger aria-label={label} className={cn("h-10 w-full sm:w-auto sm:min-w-[136px]", value && "border-brand/50")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{`${label}: All`}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DateRangeFilter({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (key: "from" | "to", value: string) => void;
}) {
  return (
    <div className="col-span-2 flex items-center gap-1.5" role="group" aria-label="Invoice date range">
      <span className="text-xs text-muted">Date</span>
      <Input type="date" aria-label="Invoice date from" className="h-10 min-w-0 flex-1 sm:w-[140px] sm:flex-none" value={from} max={to || undefined} onChange={(event) => onChange("from", event.target.value)} />
      <span className="text-xs text-muted" aria-hidden>
        to
      </span>
      <Input type="date" aria-label="Invoice date to" className="h-10 min-w-0 flex-1 sm:w-[140px] sm:flex-none" value={to} min={from || undefined} onChange={(event) => onChange("to", event.target.value)} />
    </div>
  );
}

function ShippingTab({ allowed, checking }: { allowed: boolean; checking: boolean }) {
  const [page, setPage] = useState(1);
  const [regenerate, setRegenerate] = useState<InvoiceRecord | null>(null);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["invoices", page],
    queryFn: () => api<Paginated<InvoiceRecord>>(`/api/v1/invoices?page=${page}&pageSize=20`),
    placeholderData: keepPreviousData,
    refetchInterval: (current) => {
      const items = asPaginated<InvoiceRecord>(current.state.data).items;
      return items.some((row) => row.status === "PENDING") ? 5_000 : false;
    },
    enabled: allowed,
  });
  const list = asPaginated<InvoiceRecord>(query.data);
  const retry = useMutation({
    mutationFn: (id: string) => api(`/api/v1/invoices/${id}/retry`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Generating the document again.");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const regenerateMutation = useMutation({
    mutationFn: (id: string) => api(`/api/v1/invoices/${id}/regenerate`, { method: "POST", body: JSON.stringify({ confirm: true }) }),
    onSuccess: () => {
      toast.success("Document regenerated.");
      setRegenerate(null);
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const columns: DataTableColumn<InvoiceRecord>[] = [
    {
      id: "invoice",
      header: "Document no.",
      cell: (row) => <span className="font-medium tabular-nums">{row.invoiceNumber ?? row.invoice_number ?? row.id.slice(0, 8)}</span>,
    },
    { id: "status", header: "Status", cell: (row) => <ToneBadge {...shippingStatusBadge(row.status)} /> },
    { id: "customer", header: "Customer", cell: (row) => customerName(row) },
    { id: "tracking", header: "Tracking ID", cell: (row) => <span className="tabular-nums">{row.trackingNumber ?? row.tracking_number ?? "—"}</span> },
    {
      id: "total",
      header: "Order value",
      className: "text-right tabular-nums",
      cell: (row) => formatCurrency(row.totalAmount ?? row.total_amount, row.currency),
    },
    {
      id: "actions",
      header: "",
      cell: (row) => (
        <InvoiceActions
          compact
          invoice={row}
          retrying={retry.isPending && retry.variables === row.id}
          onRetry={() => retry.mutate(row.id)}
          onRegenerate={() => setRegenerate(row)}
        />
      ),
    },
  ];
  return (
    <>
      <p className="mb-3 text-sm text-muted">
        Created when India Post returns a tracking ID. These are shipping documents, not GST tax invoices.
      </p>
      {query.isError ? (
        <EmptyState
          icon={AlertCircle}
          title="Could not load shipping documents"
          description={query.error instanceof Error && query.error.message ? query.error.message : "Check your connection and try again."}
          action={
            <Button type="button" variant="secondary" size="sm" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={list.items}
          getRowId={(row) => row.id}
          loading={checking || query.isLoading}
          fetching={query.isFetching && !query.isLoading}
          emptyTitle="No shipping documents yet"
          emptyDescription="Book a shipment from Orders. The document is created once India Post returns a tracking ID."
          emptyAction={
            <Link href="/dashboard/orders" className={buttonVariants({ variant: "secondary", size: "sm" })}>Go to Orders</Link>
          }
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          onPageChange={setPage}
        />
      )}
      <Dialog open={Boolean(regenerate)} onOpenChange={(open) => !open && !regenerateMutation.isPending && setRegenerate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate this document?</DialogTitle>
            <DialogDescription>
              The document number stays the same. The PDF is rebuilt with your current invoice design.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={regenerateMutation.isPending} onClick={() => setRegenerate(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={regenerateMutation.isPending} onClick={() => regenerate && regenerateMutation.mutate(regenerate.id)}>
              {regenerateMutation.isPending ? "Regenerating…" : "Regenerate PDF"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
