import { formatNumber } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";

type Props = {
  loading?: boolean;
  filteredLoading?: boolean;
  total?: number;
  today?: number;
  yesterday?: number;
  filtered?: number;
};

function Chip({ label, value, loading }: { label: string; value?: number; loading?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      {loading ? (
        <Skeleton className="mt-1 h-6 w-16" />
      ) : (
        <p className="text-lg font-semibold tabular-nums text-ink">{value == null ? "—" : formatNumber(value)}</p>
      )}
    </div>
  );
}

export function LabelCountStrip({ loading, filteredLoading, total, today, yesterday, filtered }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Label counts">
      <Chip label="Total Labels" value={total} loading={loading} />
      <Chip label="Today" value={today} loading={loading} />
      <Chip label="Yesterday" value={yesterday} loading={loading} />
      <Chip label="Filtered Results" value={filtered} loading={filteredLoading} />
    </div>
  );
}
