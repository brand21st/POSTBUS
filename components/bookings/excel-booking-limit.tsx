"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/hooks/use-api";

export type ExcelBookingSettings = { limit: number; max: number; jsonMax: number; defaultLimit: number };

export const EXCEL_SETTINGS_KEY = ["bulk-excel-settings"];

/** Workspace setting: how many rows one India Post Excel file may hold. */
export function ExcelBookingLimit() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: EXCEL_SETTINGS_KEY,
    queryFn: () => api<ExcelBookingSettings>("/api/v1/bookings/excel-settings"),
  });
  // null = show the saved limit; a string = the user's unsaved edit.
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? (settings.data ? String(settings.data.limit) : "");
  const setValue = (next: string) => setDraft(next);

  const save = useMutation({
    mutationFn: () =>
      api<ExcelBookingSettings>("/api/v1/bookings/excel-settings", {
        method: "PATCH",
        body: JSON.stringify({ limit: Number(value) }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(EXCEL_SETTINGS_KEY, data);
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["bulk-excel-india-post-sheet"] });
      toast.success(`India Post Excel limit set to ${data.limit} rows per file.`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const data = settings.data;
  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= (data?.max ?? 5000);

  return (
    <section className="rounded-xl border border-border p-4">
      <h2 className="text-sm font-semibold">India Post Excel booking limit</h2>
      <p className="mt-1 text-xs text-muted">
        Rows allowed in one workbook. Larger uploads are rejected and exports are split into files of this size. India
        Post takes up to {data?.max ?? 5000} articles per file and fewer than {(data?.jsonMax ?? 999) + 1} per API
        request.
      </p>
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) save.mutate();
        }}
      >
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={data?.max ?? 5000}
          className="w-32"
          aria-label="Rows per India Post file"
          value={value}
          disabled={settings.isLoading}
          onChange={(event) => setValue(event.target.value)}
        />
        <span className="text-xs text-muted">rows per file</span>
        <Button type="submit" size="sm" variant="secondary" disabled={!valid || save.isPending || String(data?.limit) === value}>
          Save limit
        </Button>
        {data ? (
          <span className="flex gap-1">
            {[data.jsonMax, data.max].map((preset) => (
              <button
                key={preset}
                type="button"
                className="rounded-md border border-border px-2 py-0.5 text-xs text-muted hover:text-foreground"
                onClick={() => setValue(String(preset))}
              >
                {preset}
              </button>
            ))}
          </span>
        ) : null}
      </form>
      {!valid && value ? (
        <p className="mt-1 text-xs text-red-600">Enter a whole number from 1 to {data?.max ?? 5000}.</p>
      ) : null}
    </section>
  );
}
