"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/hooks/use-api";
import type { AddressSummary } from "@/types/api";

function addressStatusLabel(status?: string | null) {
  switch (String(status ?? "").toUpperCase()) {
    case "READY":
      return "Ready for Booking";
    case "NEEDS_REVIEW":
      return "Address Review Required";
    case "INVALID":
      return "Invalid Shipping Details";
    default:
      return "";
  }
}

function issueText(issue: { message?: string } | string) {
  return typeof issue === "string" ? issue : issue.message || "";
}

function originalLine(address?: AddressSummary | null) {
  const original = address?.original_shipping;
  if (!original) return "";
  return [original.name, original.phone, original.address1, original.address2, original.city, original.province, original.zip]
    .filter(Boolean)
    .join(", ");
}

export function AddressReviewPanel({
  orderId,
  address,
  locked,
  onSaved,
}: {
  orderId: string;
  address?: AddressSummary | null;
  locked: boolean;
  onSaved: () => void;
}) {
  const status = String(address?.address_validation_status ?? "");
  const label = addressStatusLabel(status);
  const issues = (address?.address_validation_errors ?? []).map(issueText).filter(Boolean);
  const original = originalLine(address);
  const action = useMutation({
    mutationFn: (path: "accept" | "restore" | "revalidate") =>
      api(`/api/v1/orders/${orderId}/address/${path}`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Shipping address updated.");
      onSaved();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (status !== "NEEDS_REVIEW" && status !== "INVALID" && !original) return null;

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      {status === "NEEDS_REVIEW" || status === "INVALID" ? <p className="text-xs font-medium text-ink">{label}</p> : null}
      {issues.length ? (
        <ul className="list-disc space-y-1 pl-4 text-xs">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      {original ? (
        <p className="text-xs">
          <span className="font-medium text-ink">Original Shopify address. </span>
          {original}
        </p>
      ) : null}
      {locked ? null : (
        <div className="flex flex-wrap gap-2">
          {status === "NEEDS_REVIEW" ? (
            <Button type="button" size="sm" variant="dark-outline" disabled={action.isPending} onClick={() => action.mutate("accept")}>
              Accept suggested address
            </Button>
          ) : null}
          {original ? (
            <Button type="button" size="sm" variant="dark-outline" disabled={action.isPending} onClick={() => action.mutate("restore")}>
              Restore original
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="dark-outline" disabled={action.isPending} onClick={() => action.mutate("revalidate")}>
            Revalidate
          </Button>
        </div>
      )}
    </div>
  );
}
