import { AlertCircle, Loader2, MapPin } from "lucide-react";

export type PincodeOfficeHint = {
  name: string;
  city: string;
  state: string;
};

export function PincodeLocationHint({
  loading,
  error,
  offices,
}: {
  loading?: boolean;
  error?: string | null;
  offices?: PincodeOfficeHint[] | null;
}) {
  if (loading) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
        <Loader2 className="size-3.5 animate-spin" />
        Finding post office…
      </p>
    );
  }

  if (error) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
        <AlertCircle className="size-3.5 shrink-0" />
        {error}
      </p>
    );
  }

  if (!offices) return null;

  if (!offices.length) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-warning" aria-live="polite">
        <AlertCircle className="size-3.5 shrink-0" />
        No post office found for this pincode.
      </p>
    );
  }

  const [office, ...others] = offices;
  const location = [office.city, office.state].filter(Boolean).join(", ");
  return (
    <div
      className="mt-1.5 flex items-start gap-2 rounded-lg border border-success/20 bg-success/5 px-2.5 py-1.5 text-xs"
      aria-live="polite"
      title={offices.map((item) => item.name).join("\n")}
    >
      <MapPin className="mt-0.5 size-3.5 shrink-0 text-success" />
      <div className="min-w-0">
        <p className="truncate font-medium text-ink">
          {office.name}
          {others.length ? <span className="font-normal text-muted"> +{others.length} more</span> : null}
        </p>
        {location ? <p className="truncate text-muted">{location}</p> : null}
      </div>
    </div>
  );
}
