"use client";

import { useEffect, useMemo, useState, type ButtonHTMLAttributes } from "react";
import {
  addMonths,
  eachDayOfInterval,
  format,
  isSameDay,
  isSameMonth,
  isWithinInterval,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { CalendarDays, Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type OrderDateFilterValue =
  | { kind: "all" }
  | { kind: "today"; from: Date; to: Date }
  | { kind: "yesterday"; from: Date; to: Date }
  | { kind: "custom"; from: Date; to: Date };

type Props = {
  value: OrderDateFilterValue;
  counts: {
    all?: number;
    today?: number;
    yesterday?: number;
  };
  onChange: (value: OrderDateFilterValue) => void;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function localDayRange(date: Date) {
  const from = new Date(date);
  from.setHours(0, 0, 0, 0);
  const to = new Date(date);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

export function todayOrderRange(now = new Date()) {
  return localDayRange(now);
}

export function yesterdayOrderRange(now = new Date()) {
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return localDayRange(yesterday);
}

export function OrderDateFilter({ value, counts, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(value.kind === "custom" ? value.from : new Date())
  );
  const [draftStart, setDraftStart] = useState<Date | null>(
    value.kind === "custom" ? value.from : null
  );
  const [draftEnd, setDraftEnd] = useState<Date | null>(
    value.kind === "custom" ? value.to : null
  );

  useEffect(() => {
    if (!open) return;
    const initial = value.kind === "custom" ? value.from : new Date();
    setVisibleMonth(startOfMonth(initial));
    setDraftStart(value.kind === "custom" ? value.from : null);
    setDraftEnd(value.kind === "custom" ? value.to : null);
  }, [open, value]);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(visibleMonth);
    const firstDay = startOfWeek(monthStart, { weekStartsOn: 1 });
    return eachDayOfInterval({
      start: firstDay,
      end: new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + 41),
    });
  }, [visibleMonth]);

  function chooseDate(date: Date) {
    if (!draftStart || draftEnd) {
      setDraftStart(date);
      setDraftEnd(null);
      return;
    }
    if (date.getTime() < draftStart.getTime()) {
      setDraftStart(date);
      setDraftEnd(null);
      return;
    }
    setDraftEnd(date);
  }

  function apply() {
    if (!draftStart || !draftEnd) return;
    onChange({
      kind: "custom",
      from: localDayRange(draftStart).from,
      to: localDayRange(draftEnd).to,
    });
    setOpen(false);
  }

  const selectedLabel =
    value.kind === "custom"
      ? `${format(value.from, "MMM d")} – ${format(value.to, "MMM d")}`
      : null;
  const draftLabel = draftStart
    ? `${format(draftStart, "d MMM")}${draftEnd ? ` → ${format(draftEnd, "d MMM")}` : " → End date"}`
    : "Start date → End date";

  return (
    <>
      <div
        className="flex flex-wrap gap-2 pb-1"
        role="group"
        aria-label="Filter orders by date"
      >
        <DatePresetButton
          active={value.kind === "all"}
          onClick={() => onChange({ kind: "all" })}
        >
          All Orders ({counts.all ?? "—"})
        </DatePresetButton>
        <DatePresetButton
          active={value.kind === "today"}
          onClick={() => onChange({ kind: "today", ...todayOrderRange() })}
        >
          Today ({counts.today ?? "—"})
        </DatePresetButton>
        <DatePresetButton
          active={value.kind === "yesterday"}
          onClick={() => onChange({ kind: "yesterday", ...yesterdayOrderRange() })}
        >
          Yesterday ({counts.yesterday ?? "—"})
        </DatePresetButton>
        {selectedLabel ? (
          <div
            className="inline-flex h-10 shrink-0 items-center overflow-hidden rounded-full border border-brand bg-brand/10 text-sm font-semibold text-brand"
            aria-label={`Custom date range ${selectedLabel}`}
          >
            <button
              type="button"
              className="inline-flex h-full items-center gap-2 pl-4 pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              onClick={() => setOpen(true)}
            >
              <CalendarDays className="size-4" />
              {selectedLabel}
            </button>
            <button
              type="button"
              className="mr-1 inline-flex size-8 items-center justify-center rounded-full transition-colors hover:bg-brand/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              aria-label="Clear custom date range"
              onClick={() => onChange({ kind: "all" })}
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <DatePresetButton active={false} onClick={() => setOpen(true)}>
            <CalendarDays className="size-4" />
            Custom Date
          </DatePresetButton>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="!bottom-0 !left-0 !top-auto !w-full !max-w-none !translate-x-0 !translate-y-0 !rounded-b-none p-0 sm:!bottom-auto sm:!left-1/2 sm:!top-1/2 sm:!max-w-xl sm:!-translate-x-1/2 sm:!-translate-y-1/2 sm:!rounded-2xl">
          <div className="border-b border-border px-5 py-5 sm:px-7">
            <DialogHeader>
              <DialogTitle>Select dates</DialogTitle>
              <DialogDescription>
                Choose a start date, then an end date.
              </DialogDescription>
            </DialogHeader>
            <p
              className="mt-4 text-lg font-semibold text-ink"
              aria-live="polite"
              aria-atomic="true"
            >
              {draftLabel}
            </p>
          </div>

          <div className="px-4 py-5 sm:px-7">
            <div className="mb-5 flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Previous month"
                onClick={() => setVisibleMonth((month) => addMonths(month, -1))}
              >
                <ChevronLeft />
              </Button>
              <h3 className="text-base font-semibold text-ink">
                {format(visibleMonth, "MMMM yyyy")}
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Next month"
                onClick={() => setVisibleMonth((month) => addMonths(month, 1))}
              >
                <ChevronRight />
              </Button>
            </div>

            <div className="grid grid-cols-7 text-center">
              {WEEKDAYS.map((weekday) => (
                <div key={weekday} className="pb-2 text-xs font-semibold text-muted">
                  {weekday}
                </div>
              ))}
              {calendarDays.map((date) => {
                const inMonth = isSameMonth(date, visibleMonth);
                const start = Boolean(draftStart && isSameDay(date, draftStart));
                const end = Boolean(draftEnd && isSameDay(date, draftEnd));
                const inRange = Boolean(
                  draftStart &&
                    draftEnd &&
                    isWithinInterval(date, { start: draftStart, end: draftEnd })
                );
                const today = isSameDay(date, new Date());
                return (
                  <div
                    key={date.toISOString()}
                    className={cn(
                      "my-0.5 flex h-11 items-center justify-center",
                      inRange && "bg-brand/10",
                      start && "rounded-l-full",
                      end && "rounded-r-full",
                      start && end && "rounded-full"
                    )}
                  >
                    <button
                      type="button"
                      tabIndex={inMonth ? 0 : -1}
                      disabled={!inMonth}
                      aria-label={format(date, "EEEE, d MMMM yyyy")}
                      aria-pressed={start || end}
                      className={cn(
                        "relative flex size-11 items-center justify-center rounded-full text-sm font-medium transition-all focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
                        inMonth ? "hover:bg-surface-soft" : "invisible",
                        today && !start && !end && "border border-brand/40 text-brand",
                        (start || end) && "bg-brand text-white shadow-sm hover:bg-brand-dark"
                      )}
                      onClick={() => chooseDate(date)}
                    >
                      {format(date, "d")}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <DialogFooter className="!flex-row !justify-between border-t border-border px-5 py-4 sm:px-7">
            <Button
              type="button"
              variant="ghost"
              className="sm:mr-auto"
              onClick={() => {
                setDraftStart(null);
                setDraftEnd(null);
              }}
            >
              Clear dates
            </Button>
            <Button type="button" disabled={!draftStart || !draftEnd} onClick={apply}>
              <Check className="size-4" />
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DatePresetButton({
  active,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border px-4 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
        active
          ? "border-brand bg-brand text-white shadow-sm"
          : "border-border bg-card text-foreground hover:border-zinc-300 hover:bg-surface-soft",
        className
      )}
      {...props}
    />
  );
}
