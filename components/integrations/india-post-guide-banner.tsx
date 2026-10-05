"use client";

import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { IndiaPostBookingGuideBody } from "@/components/shipments/india-post-booking-guide";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const HIDE_KEY = "postbus:india-post-guide:hide";

export function IndiaPostGuideBanner({ selectedService }: { selectedService?: string }) {
  const [open, setOpen] = useState(false);
  const [dontShow, setDontShow] = useState(false);

  useEffect(() => {
    if (window.localStorage.getItem(HIDE_KEY) === "1") return;
    const timer = window.setTimeout(() => setOpen(true), 400);
    return () => window.clearTimeout(timer);
  }, []);

  function handleOpenChange(next: boolean) {
    if (!next) {
      if (dontShow) window.localStorage.setItem(HIDE_KEY, "1");
      else window.localStorage.removeItem(HIDE_KEY);
    }
    setOpen(next);
  }

  function openGuide() {
    setDontShow(window.localStorage.getItem(HIDE_KEY) === "1");
    setOpen(true);
  }

  return (
    <>
      <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-3 sm:flex-row sm:items-center sm:p-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <BookOpen className="size-4.5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-950">India Post Booking Guide</p>
            <p className="text-xs leading-relaxed text-amber-800">
              Parcels book from <span className="rounded bg-brand/15 px-1 font-bold tabular-nums text-brand">1 g</span>{" "}
              to 35 kg. A selected Speed Post Parcel or Business Parcel is not treated as a document when weight is
              below 500 g. Parcels need Length, Width and Height.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="shrink-0 self-start sm:self-auto"
          onClick={openGuide}
        >
          <BookOpen className="size-4" />
          View guide
        </Button>
      </div>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-3xl gap-3 overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
              <span className="flex size-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <BookOpen className="size-4" />
              </span>
              India Post Booking Guide
            </DialogTitle>
            <DialogDescription>
              Check weight and box size before booking so India Post accepts the shipment.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-950">
            <IndiaPostBookingGuideBody selectedService={selectedService} />
          </div>

          <DialogFooter className="items-stretch gap-3 sm:items-center sm:justify-between">
            <label className="flex items-center gap-2 text-sm text-muted">
              <Checkbox checked={dontShow} onCheckedChange={(value) => setDontShow(value === true)} />
              Don&apos;t show this automatically
            </label>
            <Button type="button" size="sm" onClick={() => handleOpenChange(false)}>
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
