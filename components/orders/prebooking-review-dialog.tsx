"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IndiaPostPincodeAutofill } from "@/components/address/india-post-pincode-autofill";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/hooks/use-api";
import type { PrebookingCheckResult, PrebookingOrderResult, PrebookingUiStatus } from "@/types/api";

const CHUNK = 25;

export function addressCheckLabel(status?: string | null, checking = false) {
  if (checking) return "Checking";
  switch (String(status ?? "").toUpperCase()) {
    case "READY":
      return "AI Checked";
    case "INVALID":
      return "Address error";
    case "NEEDS_REVIEW":
      return "Review required";
    case "VALIDATION_UNAVAILABLE":
      return "Check unavailable";
    default:
      return status ? "Not checked" : "";
  }
}

function statusLabel(status: PrebookingUiStatus) {
  switch (status) {
    case "ready":
      return "Ready to book";
    case "fix_required":
      return "Address error";
    case "needs_review":
      return "Review required";
    case "validation_unavailable":
      return "Check unavailable";
    case "checking":
      return "Checking";
    default:
      return "Not checked";
  }
}

type Draft = PrebookingOrderResult["address"] & {
  weightGrams: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
};

function draftFrom(order: PrebookingOrderResult): Draft {
  return {
    ...order.address,
    weightGrams: order.parcel ? String(order.parcel.weightGrams || "") : "",
    lengthCm: order.parcel ? String(order.parcel.lengthCm || "") : "",
    widthCm: order.parcel ? String(order.parcel.widthCm || "") : "",
    heightCm: order.parcel ? String(order.parcel.heightCm || "") : "",
  };
}

function safeSuggestion(order: PrebookingOrderResult) {
  return order.issues.find((issue) => {
    const suggestion = issue.suggestion;
    if (!suggestion?.line1) return false;
    if (suggestion.pincode && suggestion.pincode !== order.address.pincode) return false;
    return issue.code === "address_formatting" || issue.code === "ai_formatting";
  })?.suggestion;
}

async function precheckChunks(orderIds: string[], onProgress: (done: number, total: number) => void) {
  const orders: PrebookingOrderResult[] = [];
  for (let index = 0; index < orderIds.length; index += CHUNK) {
    const chunk = orderIds.slice(index, index + CHUNK);
    const result = await api<PrebookingCheckResult>("/api/v1/bookings/precheck", {
      method: "POST",
      body: JSON.stringify({ orderIds: chunk }),
    });
    orders.push(...result.orders);
    onProgress(Math.min(index + chunk.length, orderIds.length), orderIds.length);
  }
  return {
    total: orders.length,
    ready: orders.filter((order) => order.status === "ready").length,
    fixRequired: orders.filter((order) => order.status === "fix_required").length,
    needsReview: orders.filter((order) => order.status === "needs_review").length,
    unavailable: orders.filter((order) => order.status === "validation_unavailable").length,
    orders,
  } satisfies PrebookingCheckResult;
}

export function PrebookingReviewDialog({
  open,
  onOpenChange,
  orderIds,
  onBookReady,
  onCheckingChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderIds: string[];
  onBookReady: (orderIds: string[]) => void;
  onCheckingChange?: (orderIds: string[]) => void;
}) {
  const [result, setResult] = useState<PrebookingCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [booking, setBooking] = useState(false);

  async function runCheck(ids: string[]) {
    if (!ids.length) return;
    setChecking(true);
    onCheckingChange?.(ids);
    setProgress({ done: 0, total: ids.length });
    try {
      const next = await precheckChunks(ids, (done, total) => setProgress({ done, total }));
      setResult((current) => {
        const orders = current
          ? current.orders.map((order) => next.orders.find((item) => item.orderId === order.orderId) ?? order)
          : next.orders;
        return {
          total: orders.length,
          ready: orders.filter((order) => order.status === "ready").length,
          fixRequired: orders.filter((order) => order.status === "fix_required").length,
          needsReview: orders.filter((order) => order.status === "needs_review").length,
          unavailable: orders.filter((order) => order.status === "validation_unavailable").length,
          orders,
        };
      });
      setActiveId((current) => {
        const still = next.orders.find((order) => order.orderId === current);
        const focus = still ?? next.orders.find((order) => order.status !== "ready") ?? next.orders[0];
        if (focus) setDraft(draftFrom(focus));
        return focus?.orderId ?? null;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Address check failed.");
    } finally {
      setChecking(false);
      onCheckingChange?.([]);
    }
  }

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setDraft(null);
    setActiveId(null);
    void runCheck(orderIds);
    // The selection captured when the dialog opens is the set to check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const active = result?.orders.find((order) => order.orderId === activeId) ?? null;
  const problemFields = useMemo(() => new Set((active?.issues ?? []).map((issue) => issue.field).filter(Boolean)), [active]);
  const readyIds = result?.orders.filter((order) => order.status === "ready").map((order) => order.orderId) ?? [];
  const blocked = !result || checking || saving || result.orders.some((order) => order.status !== "ready");

  function selectOrder(order: PrebookingOrderResult) {
    setActiveId(order.orderId);
    setDraft(draftFrom(order));
  }

  function applySuggestion(order: PrebookingOrderResult) {
    const suggestion = safeSuggestion(order);
    if (!suggestion || !draft) return;
    setDraft({
      ...draft,
      line1: suggestion.line1 || draft.line1,
      line2: suggestion.line2 ?? draft.line2,
      line3: suggestion.line3 ?? draft.line3,
      city: suggestion.city || draft.city,
      state: suggestion.state || draft.state,
      pincode: suggestion.pincode || draft.pincode,
    });
    toast.success("Suggestion applied. Save changes to keep it.");
  }

  async function save(order: PrebookingOrderResult) {
    if (!draft) return;
    setSaving(true);
    try {
      await api(`/api/v1/orders/${order.orderId}/address`, {
        method: "PATCH",
        body: JSON.stringify({
          name: draft.name,
          phone: draft.phone,
          line1: draft.line1,
          line2: draft.line2,
          city: draft.city,
          state: draft.state,
          pincode: draft.pincode,
          country: draft.country || "IN",
          expectedFingerprint: order.fingerprint || undefined,
        }),
      });
      if (order.parcel) {
        const lengthCm = Number(draft.lengthCm);
        const widthCm = Number(draft.widthCm);
        const heightCm = Number(draft.heightCm);
        const weight = Number(draft.weightGrams);
        const changed =
          lengthCm !== order.parcel.lengthCm ||
          widthCm !== order.parcel.widthCm ||
          heightCm !== order.parcel.heightCm ||
          (weight > 0 && weight !== order.parcel.weightGrams);
        if (changed && lengthCm > 0 && widthCm > 0 && heightCm > 0) {
          await api(`/api/v1/orders/${order.orderId}/dimensions`, {
            method: "PATCH",
            body: JSON.stringify({
              lengthCm,
              widthCm,
              heightCm,
              boxWeightGrams: weight > 0 ? weight : undefined,
            }),
          });
        }
      }
      toast.success("Shipping address saved.");
      await runCheck([order.orderId]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the address.");
    } finally {
      setSaving(false);
    }
  }

  async function applySafeAll() {
    const targets = (result?.orders ?? []).filter((order) => safeSuggestion(order));
    if (!targets.length) {
      toast.message("No safe address suggestions to apply.");
      return;
    }
    setSaving(true);
    try {
      for (const order of targets) {
        const suggestion = safeSuggestion(order)!;
        await api(`/api/v1/orders/${order.orderId}/address`, {
          method: "PATCH",
          body: JSON.stringify({
            name: order.address.name,
            phone: order.address.phone,
            line1: suggestion.line1 || order.address.line1,
            line2: suggestion.line2 ?? order.address.line2,
            city: suggestion.city || order.address.city,
            state: suggestion.state || order.address.state,
            pincode: order.address.pincode,
            country: order.address.country || "IN",
            expectedFingerprint: order.fingerprint || undefined,
          }),
        });
      }
      toast.success("Safe suggestions saved. Rechecking those orders.");
      await runCheck(targets.map((order) => order.orderId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not apply suggestions.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>AI Address Check</DialogTitle>
          <DialogDescription>
            Correct shipping details here. Booking stays on this orders list.
          </DialogDescription>
        </DialogHeader>
        {checking ? (
          <p className="text-sm text-muted-foreground">
            Checking {progress.done} of {progress.total || orderIds.length}…
          </p>
        ) : null}
        {result ? (
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Summary label="Total" value={result.total} />
            <Summary label="Ready" value={result.ready} />
            <Summary label="Critical" value={result.fixRequired} />
            <Summary label="Review" value={result.needsReview + result.unavailable} />
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
          <div className="max-h-64 space-y-1 overflow-y-auto md:max-h-[28rem]">
            {(result?.orders ?? []).map((order) => (
              <button
                key={order.orderId}
                type="button"
                className={`w-full rounded-lg border px-2 py-1.5 text-left text-xs ${order.orderId === activeId ? "border-brand bg-surface-soft" : "border-border"}`}
                onClick={() => selectOrder(order)}
              >
                <span className="block font-medium">#{order.orderNumber || order.orderId.slice(0, 8)}</span>
                <span className="text-muted-foreground">{order.customerName || "Customer"} · {statusLabel(order.status)}</span>
              </button>
            ))}
          </div>
          {active && draft ? (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">Order #{active.orderNumber || active.orderId.slice(0, 8)}</p>
                <p className="text-xs text-muted-foreground">
                  {active.customerName || "Customer"} · {statusLabel(active.status)} · {active.issues.length} issue{active.issues.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="space-y-2">
                {active.issues.map((issue, index) => (
                  <div key={`${issue.code}-${index}`} className="rounded-lg border border-border p-2 text-xs">
                    <p className="font-medium">{issue.message}</p>
                    {issue.suggestion?.line1 ? (
                      <p className="mt-1 text-muted-foreground">Suggestion: {[issue.suggestion.line1, issue.suggestion.line2, issue.suggestion.city, issue.suggestion.state].filter(Boolean).join(", ")}</p>
                    ) : null}
                    {issue.offices?.length ? (
                      <p className="mt-1 text-muted-foreground">{issue.offices.map((office) => office.name).join(", ")}</p>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Customer name" problem={problemFields.has("name") || problemFields.has("address")}>
                  <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                </Field>
                <Field label="Mobile" problem={problemFields.has("phone") || problemFields.has("address")}>
                  <Input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} />
                </Field>
                <Field label="Address line 1" problem={problemFields.has("line1") || problemFields.has("address")} className="sm:col-span-2">
                  <Input value={draft.line1} onChange={(event) => setDraft({ ...draft, line1: event.target.value })} />
                </Field>
                <Field label="Address line 2" problem={problemFields.has("line2")} className="sm:col-span-2">
                  <Input value={draft.line2} onChange={(event) => setDraft({ ...draft, line2: event.target.value })} />
                </Field>
                <Field label="PIN code" problem={problemFields.has("pincode")}>
                  <Input
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="postal-code"
                    value={draft.pincode}
                    onChange={(event) =>
                      setDraft({ ...draft, pincode: event.target.value.replace(/\D/g, "").slice(0, 6) })
                    }
                  />
                  <IndiaPostPincodeAutofill
                    pincode={draft.pincode}
                    fillKey={active.orderId}
                    onFill={({ city, state }) =>
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              ...(city ? { city } : {}),
                              ...(state ? { state } : {}),
                            }
                          : current
                      )
                    }
                  />
                </Field>
                <Field label="City" problem={problemFields.has("city")}>
                  <Input value={draft.city} onChange={(event) => setDraft({ ...draft, city: event.target.value })} />
                </Field>
                <Field label="State" problem={problemFields.has("state")}>
                  <Input value={draft.state} onChange={(event) => setDraft({ ...draft, state: event.target.value })} />
                </Field>
                <Field label="Country" problem={problemFields.has("country")}>
                  <Input value={draft.country} onChange={(event) => setDraft({ ...draft, country: event.target.value })} />
                </Field>
                {active.parcel ? (
                  <>
                    <Field label="Weight (g)" problem={problemFields.has("physical_weight") || problemFields.has("weight")}>
                      <Input value={draft.weightGrams} onChange={(event) => setDraft({ ...draft, weightGrams: event.target.value })} />
                    </Field>
                    <Field label="Length (cm)" problem={problemFields.has("length")}>
                      <Input value={draft.lengthCm} onChange={(event) => setDraft({ ...draft, lengthCm: event.target.value })} />
                    </Field>
                    <Field label="Width (cm)" problem={problemFields.has("breadth") || problemFields.has("width")}>
                      <Input value={draft.widthCm} onChange={(event) => setDraft({ ...draft, widthCm: event.target.value })} />
                    </Field>
                    <Field label="Height (cm)" problem={problemFields.has("height")}>
                      <Input value={draft.heightCm} onChange={(event) => setDraft({ ...draft, heightCm: event.target.value })} />
                    </Field>
                  </>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" disabled={!safeSuggestion(active) || saving} onClick={() => applySuggestion(active)}>
                  Apply suggestion
                </Button>
                <Button type="button" size="sm" disabled={saving} onClick={() => void save(active)}>
                  Save changes
                </Button>
                <Button type="button" size="sm" variant="secondary" disabled={checking || saving} onClick={() => void runCheck([active.orderId])}>
                  Recheck address
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{checking ? "Checking addresses…" : "Select an order to review it."}</p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={saving || checking} onClick={() => void applySafeAll()}>
            Apply safe suggestions
          </Button>
          <Button type="button" variant="secondary" disabled={checking || !orderIds.length} onClick={() => void runCheck(orderIds)}>
            Revalidate
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!readyIds.length || checking || saving || booking}
            onClick={() => {
              setBooking(true);
              onBookReady(readyIds);
              onOpenChange(false);
              setBooking(false);
            }}
          >
            Book valid orders
          </Button>
          <Button
            type="button"
            disabled={blocked || booking}
            onClick={() => {
              setBooking(true);
              onBookReady(readyIds);
              onOpenChange(false);
              setBooking(false);
            }}
          >
            Book now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border px-2 py-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}

function Field({
  label,
  problem,
  className,
  children,
}: {
  label: string;
  problem?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Label className={`space-y-1 text-xs ${problem ? "text-red-700" : ""} ${className ?? ""}`}>
      <span>{label}</span>
      {children}
    </Label>
  );
}
