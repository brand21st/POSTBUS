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
  error?: Error | string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  getRowId?: (row: TData) => string;
  selectable?: boolean;
  onSelectionChange?: (ids: string[]) => void;
  onRowClick?: (row: TData) => void;
  getRowClassName?: (row: TData) => string | undefined;
};

export function DataTable<TData extends Record<string, unknown>>({
  columns,
  data,
  loading,
  error,
  emptyTitle = "Nothing here yet",
  emptyDescription = "When records appear they will show up in this table.",
  emptyAction,
  page = 1,
  pageSize = 20,
  total = 0,
  onPageChange,
  getRowId,
  selectable,
  onSelectionChange,
  onRowClick,
  getRowClassName,
}: DataTableProps<TData>) {
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
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all rows"
            checked={table.getIsAllRowsSelected()}
            onCheckedChange={(value) => {
              table.toggleAllRowsSelected(!!value);
              if (!onSelectionChange) return;
              onSelectionChange(value ? table.getRowModel().rows.map((row) => row.id) : []);
            }}
          />
        ),
        cell: ({ row, table }) => (
          <Checkbox
            aria-label="Select row"
            checked={row.getIsSelected()}
            onCheckedChange={(value) => {
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
  }, [columns, onSelectionChange, selectable]);

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
        <div className="space-y-3 p-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-11 w-full" />
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

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
          className="border-0 shadow-none"
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border bg-surface-soft/70">
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => (
                    <th
                      key={header.id}
                      className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted"
                    >
                      {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b border-border last:border-0 transition-colors",
                    getRowClassName?.(row.original) ?? "hover:bg-surface-soft/60",
                    onRowClick && "cursor-pointer"
                  )}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getAllCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 align-middle text-foreground">
                      <table.FlexRender cell={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {onPageChange ? (
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
          <p className="text-sm text-muted">
            {total === 0
              ? "0 results"
              : `Showing ${(page - 1) * pageSize + (rows.length ? 1 : 0)}–${Math.min(page * pageSize, total)} of ${total}`}
          </p>
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
        </div>
      ) : null}
    </div>
  );
}
