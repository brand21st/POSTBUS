"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FileSpreadsheet } from "lucide-react";
import { BulkExcelWizard } from "@/components/bookings/bulk-excel-wizard";
import { AutomationSettingsButton } from "@/components/booking-queue/automation-settings-dialog";
import { BookingDetailDialog } from "@/components/booking-queue/booking-detail-dialog";
import { historyColumns, queueColumns } from "@/components/booking-queue/queue-columns";
import { ApproveAllWaiting, QueueBulkActions } from "@/components/booking-queue/queue-actions";
import { QueueKpiStrip } from "@/components/booking-queue/queue-kpi-strip";
import {
  parseQueueUrl,
  QUEUE_SOURCE_LABELS,
  QUEUE_SUMMARY_KEY,
  queueApiQuery,
  queueRefetchInterval,
  queueUrl,
  type QueueBucketFilter,
  type QueueTab,
  type QueueUrlState,
} from "@/components/booking-queue/view";
import { DataTable } from "@/components/dashboard/data-table";
import { OrderDateFilter, type OrderDateFilterValue } from "@/components/dashboard/order-date-filter";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import type { BookingHistoryRow, QueueListItem, QueueSummary } from "@/modules/booking-queue/service";

type Page<T> = { enabled: boolean; items: T[]; page: number; pageSize: number; total: number };

const PAGE_SIZE = 25;

/**
 * Bulk Booking: a permanent view of every order in the booking queue, the booking history,
 * and Excel imports. Everything shown comes from the database; a refresh loses nothing.
 */
export function BookingQueueDashboard({ summary }: { summary: QueueSummary }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const url = useMemo(() => parseQueueUrl(new URLSearchParams(params.toString())), [params]);
  const [search, setSearch] = useState(url.q);
  const [dateFilter, setDateFilter] = useState<OrderDateFilterValue>({ kind: "all" });
  const [selected, setSelected] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const committedSearch = useRef(url.q.trim());

  const navigate = (next: Partial<QueueUrlState>, options: { resetSelection?: boolean } = {}) => {
    const merged = { ...url, ...next };
    if (options.resetSelection !== false) setSelected([]);
    router.replace(`${pathname}${queueUrl(merged)}`, { scroll: false });
  };

  // Search is committed after a pause, like the Orders page; a new search clears the selection.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = search.trim();
      if (next === committedSearch.current) return;
      committedSearch.current = next;
      navigate({ q: next, page: 1 });
    }, 350);
    return () => window.clearTimeout(timer);
    // navigate is recreated every render; the search text is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const liveSummary = useQuery({
    queryKey: QUEUE_SUMMARY_KEY,
    queryFn: () => api<QueueSummary>("/api/v1/booking-queue/summary"),
    initialData: summary,
    refetchInterval: (query) => queueRefetchInterval(query.state.data),
  });
  const interval = queueRefetchInterval(liveSummary.data);
  const from = dateFilter.kind === "all" ? undefined : dateFilter.from.toISOString();
  const to = dateFilter.kind === "all" ? undefined : dateFilter.to.toISOString();

  const queue = useQuery({
    queryKey: ["booking-queue", url.bucket, url.source, url.q, url.page, from, to],
    enabled: url.tab === "queue",
    placeholderData: keepPreviousData,
    refetchInterval: interval,
    queryFn: () =>
      api<Page<QueueListItem>>(
        `/api/v1/booking-queue?${queueApiQuery({ bucket: url.bucket, source: url.source, q: url.q, page: url.page, pageSize: PAGE_SIZE, from, to })}`
      ),
  });
  const history = useQuery({
    queryKey: ["booking-queue-history", url.source, url.q, url.page, from, to],
    enabled: url.tab === "history",
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<Page<BookingHistoryRow>>(
        `/api/v1/booking-queue/history?${queueApiQuery({ source: url.source, q: url.q, page: url.page, pageSize: PAGE_SIZE, from, to })}`
      ),
  });

  const columns = useMemo(() => queueColumns((row) => setDetailId(row.id)), []);
  const historyCols = useMemo(() => historyColumns(), []);
  const counts = liveSummary.data?.counts;
  const settings = liveSummary.data?.settings;

  const filters = (
    <div className="min-w-0 space-y-2 rounded-xl border border-border bg-card p-2 sm:p-2.5">
      <OrderDateFilter
        value={dateFilter}
        counts={{}}
        onChange={(next) => {
          setDateFilter(next);
          navigate({ page: 1 });
        }}
      />
      <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search order number, customer, phone, barcode…"
          className="h-8 w-full min-w-0 shadow-none lg:max-w-sm"
          aria-label="Search"
        />
        <Select value={url.source} onValueChange={(value) => navigate({ source: value, page: 1 })}>
          <SelectTrigger className="h-8 shadow-none lg:w-48" aria-label="Source">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {Object.entries(QUEUE_SOURCE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={() => {
            setSearch("");
            committedSearch.current = "";
            setDateFilter({ kind: "all" });
            navigate({ bucket: "all", source: "all", q: "", page: 1 });
          }}
        >
          Reset
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        title="Bulk Booking"
        description="Every order waiting for India Post booking, its result, and your Excel imports."
        icon={
          <span className="flex size-9 items-center justify-center rounded-xl bg-rose-100 text-brand">
            <FileSpreadsheet className="size-5" />
          </span>
        }
        actions={
          <>
            <AutomationSettingsButton />
            <Link href="/dashboard/orders" className="text-sm text-muted hover:text-foreground">
              Back to orders
            </Link>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted">
        <span>
          Mode: <span className="font-medium text-ink">{settings?.mode === "AUTOMATIC" ? "Automatic" : "Manual"}</span>
          {settings?.paused ? <span className="ml-1 font-medium text-amber-700">(paused)</span> : null}
        </span>
        <span>
          India Post transport: <span className="font-medium text-ink">one article per request</span>
        </span>
        <span>
          Oldest ready order:{" "}
          <span className="font-medium text-ink">
            {liveSummary.data?.oldestReadyAt ? formatDate(liveSummary.data.oldestReadyAt, true) : "none"}
          </span>
        </span>
        <span>
          Active batches: <span className="font-medium text-ink">{liveSummary.data?.activeRuns ?? 0}</span>
        </span>
      </div>

      <Tabs value={url.tab} onValueChange={(value) => navigate({ tab: value as QueueTab, page: 1 })}>
        <TabsList>
          <TabsTrigger value="queue">Queue{counts ? ` · ${counts.total - counts.booked - counts.excluded}` : ""}</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="imports">Excel imports</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-4 space-y-3">
          <QueueKpiStrip
            summary={liveSummary.data}
            loading={liveSummary.isLoading}
            error={liveSummary.isError}
            active={url.bucket}
            onSelect={(bucket: QueueBucketFilter) => navigate({ bucket, page: 1 })}
          />
          {filters}
          {counts?.waitingApproval ? (
            <div className="flex justify-end">
              <ApproveAllWaiting waiting={counts.waitingApproval} />
            </div>
          ) : null}
          {selected.length ? (
            <div className="sticky top-2 z-20 flex flex-col gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium text-ink">
                {selected.length === 1 ? "1 selected" : `${selected.length} selected`}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <QueueBulkActions selectedIds={selected} onDone={() => setSelected([])} />
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelected([])}>
                  Clear selection
                </Button>
              </div>
            </div>
          ) : null}
          <DataTable
            columns={columns}
            data={(queue.data?.items ?? []) as Array<QueueListItem & Record<string, unknown>>}
            loading={queue.isLoading}
            fetching={queue.isFetching}
            error={queue.error as Error | null}
            emptyTitle="Nothing in the queue"
            emptyDescription="Select orders on the Orders page and choose Add to Bulk Booking, or import an Excel file."
            page={url.page}
            pageSize={PAGE_SIZE}
            total={queue.data?.total ?? 0}
            onPageChange={(page) => navigate({ page }, { resetSelection: false })}
            paginationStyle="numbered"
            getRowId={(row) => row.id}
            selectable
            selectedIds={selected}
            onSelectionChange={setSelected}
            onRowClick={(row) => setDetailId(row.id)}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-4 space-y-3">
          {filters}
          <DataTable
            columns={historyCols}
            data={(history.data?.items ?? []) as Array<BookingHistoryRow & Record<string, unknown>>}
            loading={history.isLoading}
            fetching={history.isFetching}
            error={history.error as Error | null}
            emptyTitle="No bookings yet"
            emptyDescription="Shipments India Post has booked appear here, whether booked here or from the Orders page."
            page={url.page}
            pageSize={PAGE_SIZE}
            total={history.data?.total ?? 0}
            onPageChange={(page) => navigate({ page }, { resetSelection: false })}
            paginationStyle="numbered"
            getRowId={(row) => row.shipmentId}
          />
        </TabsContent>

        <TabsContent value="imports" className="mt-4">
          <BulkExcelWizard
            embedded
            queueMode
            initialBatchId={url.importId}
            onBatchChange={(importId) => navigate({ tab: "imports", importId }, { resetSelection: false })}
            onOpenQueue={() => navigate({ tab: "queue", bucket: "waitingApproval", page: 1, importId: null })}
          />
        </TabsContent>
      </Tabs>

      <BookingDetailDialog itemId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
