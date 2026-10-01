import { PackageSearch } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

export function TrackSkeletons() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export function TrackEmptyState() {
  return (
    <EmptyState
      icon={PackageSearch}
      title="Track your India Post shipment"
      description="Enter your article number above to view the complete shipment journey."
    />
  );
}

export function TrackErrorState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div
      className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-red-900"
      role="alert"
      aria-live="polite"
    >
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm">{description}</p>
    </div>
  );
}
