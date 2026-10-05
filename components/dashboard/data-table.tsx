"use client";

import { useMemo, type ReactNode } from "react";
import {
  createColumnHelper,
  rowSelectionFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { AlertCircle, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { displayValue } from "@/lib/format";
import { cn } from "@/lib/utils";

const features = tableFeatures({
  rowSelectionFeature,
});

const EMPTY_DATA: Record<string, never>[] = [];

export type DataTableColumn<TData extends Record<string, unknown>> = {
  id: string;
  header: string;
  accessorKey?: keyof TData & string;
  cell?: (row: TData) => ReactNode;
  className?: string;
};

export type DataTableProps<TData extends Record<string, unknown>> = {
  columns: DataTableColumn<TData>[];
  data: TData[];
  loading?: boolean;
  fetching?: boolean;
  error?: Error | string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;
  paginationStyle?: "simple" | "numbered";
  density?: "default" | "compact";
  mobileView?: ReactNode;
  onRowHover?: (row: TData) => void;
  getRowId?: (row: TData) => string;
  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  onRowClick?: (row: TData) => void;
  getRowClassName?: (row: TData) => string | undefined;
};

function paginationPages(page: number, pageCount: number) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1) as Array<number | "ellipsis">;
  }
  const pages: Array<number | "ellipsis"> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 2);
  if (start > 2) pages.push("ellipsis");
  for (let current = start; current <= end; current += 1) pages.push(current);
  if (end < pageCount - 1) pages.push("ellipsis");
  pages.push(pageCount);
  return pages;
}

export function DataTable<TData extends Record<string, unknown>>({
  columns,
  data,
  loading,
  fetching,
  error,
  emptyTitle = "Nothing here yet",
  emptyDescription = "When records appear they will show up in this table.",
  emptyAction,
  page = 1,
  pageSize = 20,
  total = 0,
  onPageChange,
  pageSizeOptions,
  onPageSizeChange,
  paginationStyle = "simple",
  density = "default",
  mobileView,
  onRowHover,
  getRowId,
  selectable,
  selectedIds,
  onSelectionChange,
  onRowClick,
  getRowClassName,
}: DataTableProps<TData>) {
  const compact = density === "compact";
  const cellPad = compact ? "px-3 py-2" : "px-4 py-3";
  const columnById = useMemo(
    () => new Map(columns.map((column) => [column.id, column])),
    [columns]
  );

  const columnDefs = useMemo(() => {
    const helper = createColumnHelper<typeof features, TData>();
    const mapped = columns.map((column) =>
      helper.display({
        id: column.id,
        header: column.header,
        cell: ({ row }) =>
          column.cell
            ? column.cell(row.original)
            : column.accessorKey
              ? displayValue(row.original[column.accessorKey])
              : null,
      })
    );

    if (!selectable) return helper.columns(mapped);

    return helper.columns([
      helper.display({
        id: "_select",
        header: ({ table }) => {
          const visibleIds = table.getRowModel().rows.map((row) => row.id);
          const selectedVisible = selectedIds
            ? visibleIds.filter((id) => selectedIds.includes(id)).length
            : table.getIsAllRowsSelected()
              ? visibleIds.length
              : 0;
          const allVisibleSelected = visibleIds.length > 0 && selectedVisible === visibleIds.length;
          return (
            <Checkbox
              aria-label="Select all visible orders"
              checked={
                allVisibleSelected ? true : selectedVisible > 0 ? "indeterminate" : false
              }
              onCheckedChange={(value) => {
                if (selectedIds) {
                  onSelectionChange?.(value ? visibleIds : []);
                  return;
                }
                table.toggleAllRowsSelected(!!value);
                if (!onSelectionChange) return;
                onSelectionChange(value ? visibleIds : []);
              }}
            />
          );
        },
        cell: ({ row, table }) => (
          <Checkbox
            aria-label="Select row"
            checked={selectedIds ? selectedIds.includes(row.id) : row.getIsSelected()}
            onCheckedChange={(value) => {
              if (selectedIds) {
                onSelectionChange?.(
                  value
                    ? Array.from(new Set([...selectedIds, row.id]))
                    : selectedIds.filter((id) => id !== row.id)
                );
                return;
              }
              row.toggleSelected(!!value);
              if (!onSelectionChange) return;
              const current = table.getSelectedRowModel().rows.map((selected) => selected.id);
              onSelectionChange(
                value
                  ? Array.from(new Set([...current, row.id]))
                  : current.filter((id) => id !== row.id)
              );
            }}
            onClick={(event) => event.stopPropagation()}
          />
        ),
      }),
      ...mapped,
    ]);
  }, [columns, onSelectionChange, selectable, selectedIds]);

  const tableData = (data.length ? data : EMPTY_DATA) as TData[];

  const table = useTable({
    features,
    columns: columnDefs,
    data: tableData,
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
  });

  if (loading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="space-y-2 p-3">
          <Skeleton className="h-8 w-full" />
          {Array.from({ length: compact ? 8 : 6 }).map((_, index) => (
            <Skeleton key={index} className={cn("w-full", compact ? "h-9" : "h-11")} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    const message = typeof error === "string" ? error : error.message;
    return (
      <EmptyState
        icon={AlertCircle}
        title="Could not load this list"
        description={message || "Try again in a moment."}
      />
    );
  }

  const rows = table.getRowModel().rows;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + (rows.length ? 1 : 0);
  const to = Math.min(page * pageSize, total);

  const pager = onPageChange ? (
    <div
      className={cn(
        "flex flex-col gap-3 border-t border-border sm:flex-row sm:items-center sm:justify-between",
        compact ? "px-3 py-2.5" : "px-4 py-3"
      )}
    >
      <p className="text-xs text-muted sm:text-sm">
        {total === 0 ? "0 results" : `Showing ${from}–${to} of ${total}${paginationStyle === "numbered" ? " orders" : ""}`}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
        {paginationStyle === "numbered" ? (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={page <= 1}
              aria-label="Previous page"
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <div className="hidden items-center gap-1 md:flex">
              {paginationPages(page, pageCount).map((item, index) =>
                item === "ellipsis" ? (
                  <span key={`e-${index}`} className="px-1 text-xs text-muted">
                    …
                  </span>
                ) : (
                  <Button
                    key={item}
                    type="button"
                    variant={item === page ? "primary" : "ghost"}
                    size="icon-xs"
                    className={item === page ? "rounded-md" : "rounded-md text-muted"}
                    onClick={() => onPageChange(item)}
                  >
                    {item}
                  </Button>
                )
              )}
            </div>
            <span className="text-xs text-muted md:hidden">
              {page} / {pageCount}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={page >= pageCount}
              aria-label="Next page"
              onClick={() => onPageChange(page + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft className="size-4" />
              Previous
            </Button>
            <span className="text-sm text-muted">
              {page} / {pageCount}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={page >= pageCount}
              onClick={() => onPageChange(page + 1)}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        )}
        {pageSizeOptions?.length && onPageSizeChange ? (
          <label className="flex items-center gap-2 text-xs text-muted">
            Rows per page
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                onPageSizeChange(Number(value));
              }}
            >
              <SelectTrigger className="h-8 w-[4.5rem] px-2 text-xs shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
      {fetching ? (
        <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-brand/15">
          <div className="h-full w-1/3 animate-pulse bg-brand" />
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
          className="border-0 shadow-none"
        />
      ) : (
        <>
          {mobileView ? <div className="md:hidden">{mobileView}</div> : null}
          <div className={cn("overflow-x-auto", mobileView && "hidden md:block")}>
            <table className={cn("w-full text-left text-sm", compact ? "min-w-[880px]" : "min-w-[720px]")}>
              <thead className="border-b border-border bg-surface-soft/70">
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header, index) => (
                      <th
                        key={header.id}
                        className={cn(
                          "text-xs font-semibold uppercase tracking-wide text-muted",
                          cellPad,
                          index === 0 && "pl-6",
                          index === group.headers.length - 1 && "pr-6",
                          header.id === "_select" && "w-10",
                          columnById.get(header.id)?.className
                        )}
                      >
                        {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {rows.map((row) => {
                  const cells = row.getAllCells();
                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        "border-b border-border last:border-0 transition-colors duration-150",
                        getRowClassName?.(row.original) ?? "hover:bg-surface-soft/60",
                        onRowClick && "cursor-pointer",
                        selectedIds?.includes(row.id) && "ring-1 ring-inset ring-brand/20"
                      )}
                      onClick={() => onRowClick?.(row.original)}
                      onMouseEnter={() => onRowHover?.(row.original)}
                    >
                      {cells.map((cell, index) => (
                        <td
                          key={cell.id}
                          className={cn(
                            "align-middle text-foreground",
                            cellPad,
                            index === 0 && "pl-6",
                            index === cells.length - 1 && "pr-6",
                            columnById.get(cell.column.id)?.className
                          )}
                        >
                          <table.FlexRender cell={cell} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {pager}
    </div>
  );
}
