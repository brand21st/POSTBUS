"use client";

import { useMemo, useState, type ButtonHTMLAttributes } from "react";
import {
  addMonths,
  eachDayOfInterval,
  format,
  isSameDay,
  isSameMonth,
  isWithinInterval,
  startOfDay,
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
import { parseCalendarDate, type LabelDatePreset } from "@/modules/labels/date-range";
import { cn } from "@/lib/utils";

export type LabelDateFilterValue =
  | { kind: "all" }
  | { kind: "today" }
  | { kind: "yesterday" }
  | { kind: "custom"; on: string }
  | { kind: "range"; from: string; to: string };

type PickerMode = "day" | "range" | null;

type Props = {
  value: LabelDateFilterValue;
  onChange: (value: LabelDateFilterValue) => void;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toIsoDate(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function fromIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function toLabelDateFilterValue(state: {
  date: LabelDatePreset;
  on: string | null;
  from: string | null;
  to: string | null;
}): LabelDateFilterValue {
  if (state.date === "today") return { kind: "today" };
  if (state.date === "yesterday") return { kind: "yesterday" };
  if (state.date === "custom" && state.on) return { kind: "custom", on: state.on };
  if (state.date === "range" && state.from && state.to) return { kind: "range", from: state.from, to: state.to };
  return { kind: "all" };
}

export function LabelDateFilter({ value, onChange }: Props) {
  const [picker, setPicker] = useState<PickerMode>(null);
  const open = picker !== null;
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()));
  const [draftStart, setDraftStart] = useState<Date | null>(null);
  const [draftEnd, setDraftEnd] = useState<Date | null>(null);

  function openPicker(mode: Exclude<PickerMode, null>) {
    if (mode === "day") {
      const initial = value.kind === "custom" ? fromIsoDate(value.on) : new Date();
      setVisibleMonth(startOfMonth(initial));
      setDraftStart(value.kind === "custom" ? fromIsoDate(value.on) : null);
      setDraftEnd(null);
    } else {
      const start = value.kind === "range" ? fromIsoDate(value.from) : new Date();
      setVisibleMonth(startOfMonth(start));
      setDraftStart(value.kind === "range" ? fromIsoDate(value.from) : null);
      setDraftEnd(value.kind === "range" ? fromIsoDate(value.to) : null);
    }
    setPicker(mode);
  }

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(visibleMonth);
    const firstDay = startOfWeek(monthStart, { weekStartsOn: 1 });
    return eachDayOfInterval({
      start: firstDay,
      end: new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + 41),
    });
  }, [visibleMonth]);

  function chooseDate(date: Date) {
    if (picker === "day") {
      const on = parseCalendarDate(toIsoDate(date));
      if (!on) return;
      onChange({ kind: "custom", on });
      setPicker(null);
      return;
    }
    const completeRange = Boolean(draftStart && draftEnd && !isSameDay(draftStart, draftEnd));
    if (!draftStart || completeRange) {
      setDraftStart(date);
      setDraftEnd(date);
      return;
    }
    if (isSameDay(date, draftStart)) {
      setDraftEnd(date);
      return;
    }
    if (date.getTime() < startOfDay(draftStart).getTime()) {
      setDraftEnd(draftStart);
      setDraftStart(date);
      return;
    }
    setDraftEnd(date);
  }

  function applyRange() {
    if (!draftStart) return;
    const end = draftEnd ?? draftStart;
    const from = parseCalendarDate(toIsoDate(draftStart));
    const to = parseCalendarDate(toIsoDate(end));
    if (!from || !to) return;
    onChange({ kind: "range", from, to });
    setPicker(null);
  }

  const customLabel = value.kind === "custom" ? format(fromIsoDate(value.on), "d MMM yyyy") : null;
  const rangeLabel =
    value.kind === "range" ? `${format(fromIsoDate(value.from), "d MMM")} – ${format(fromIsoDate(value.to), "d MMM")}` : null;
  const draftLabel =
    picker === "day"
      ? draftStart
        ? format(draftStart, "d MMM yyyy")
        : "Select a date"
      : draftStart
        ? draftEnd && !isSameDay(draftStart, draftEnd)
          ? `${format(draftStart, "d MMM")} → ${format(draftEnd, "d MMM")}`
          : format(draftStart, "d MMM yyyy")
        : "Select a date";

  return (
    <>
      <div className="flex min-w-0 flex-wrap gap-1.5" role="group" aria-label="Filter labels by generated date">
        <DatePresetButton active={value.kind === "all"} onClick={() => onChange({ kind: "all" })}>
          All Labels
        </DatePresetButton>
        <DatePresetButton active={value.kind === "today"} onClick={() => onChange({ kind: "today" })}>
          Today
        </DatePresetButton>
        <DatePresetButton active={value.kind === "yesterday"} onClick={() => onChange({ kind: "yesterday" })}>
          Yesterday
        </DatePresetButton>
        {customLabel ? (
          <ActiveChip
            label={customLabel}
            ariaLabel={`Custom date ${customLabel}`}
            onOpen={() => openPicker("day")}
            onClear={() => onChange({ kind: "all" })}
          />
        ) : (
          <DatePresetButton active={false} onClick={() => openPicker("day")}>
            <CalendarDays className="size-4" />
            Custom Date
          </DatePresetButton>
        )}
        {rangeLabel ? (
          <ActiveChip
            label={rangeLabel}
            ariaLabel={`Date range ${rangeLabel}`}
            onOpen={() => openPicker("range")}
            onClear={() => onChange({ kind: "all" })}
          />
        ) : (
          <DatePresetButton active={false} onClick={() => openPicker("range")}>
            <CalendarDays className="size-4" />
            Date Range
          </DatePresetButton>
        )}
      </div>

      <Dialog open={open} onOpenChange={(next) => (next ? openPicker(picker ?? "day") : setPicker(null))}>
        <DialogContent className="!bottom-0 !left-0 !top-auto !w-full !max-w-none !translate-x-0 !translate-y-0 !rounded-b-none p-0 sm:!bottom-auto sm:!left-1/2 sm:!top-1/2 sm:!max-w-xl sm:!-translate-x-1/2 sm:!-translate-y-1/2 sm:!rounded-2xl">
          <div className="border-b border-border px-5 py-5 sm:px-7">
            <DialogHeader>
              <DialogTitle>{picker === "day" ? "Select a date" : "Select dates"}</DialogTitle>
              <DialogDescription>
                {picker === "day"
                  ? "Show labels generated on this calendar date."
                  : "Choose one day, or a start date and then an end date. Both days are included."}
              </DialogDescription>
            </DialogHeader>
            <p className="mt-4 text-lg font-semibold text-ink" aria-live="polite" aria-atomic="true">
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
              <h3 className="text-base font-semibold text-ink">{format(visibleMonth, "MMMM yyyy")}</h3>
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
                const end = Boolean(picker === "range" && draftEnd && isSameDay(date, draftEnd));
                const inRange = Boolean(
                  picker === "range" &&
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
                      start && picker === "range" && "rounded-l-full",
                      end && "rounded-r-full",
                      (picker === "day" || (start && end)) && "rounded-full"
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

          {picker === "range" ? (
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
              <Button type="button" disabled={!draftStart} onClick={applyRange}>
                <Check className="size-4" />
                Apply
              </Button>
            </DialogFooter>
          ) : (
            <DialogFooter className="border-t border-border px-5 py-4 sm:px-7">
              <Button type="button" variant="ghost" onClick={() => setPicker(null)}>
                Cancel
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ActiveChip({
  label,
  ariaLabel,
  onOpen,
  onClear,
}: {
  label: string;
  ariaLabel: string;
  onOpen: () => void;
  onClear: () => void;
}) {
  return (
    <div
      className="inline-flex h-8 shrink-0 items-center overflow-hidden rounded-full border border-brand bg-brand/10 text-xs font-semibold text-brand"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        className="inline-flex h-full items-center gap-2 pl-4 pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        onClick={onOpen}
      >
        <CalendarDays className="size-4" />
        {label}
      </button>
      <button
        type="button"
        className="mr-1 inline-flex size-8 items-center justify-center rounded-full transition-colors hover:bg-brand/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        aria-label="Clear date filter"
        onClick={onClear}
      >
        <X className="size-4" />
      </button>
    </div>
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
        "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
        active
          ? "border-brand bg-brand text-white shadow-sm"
          : "border-border bg-card text-foreground hover:border-zinc-300 hover:bg-surface-soft",
        className
      )}
      {...props}
    />
  );
}
