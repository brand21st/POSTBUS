"use client";

import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Undo2 } from "lucide-react";
import { useReadOnly } from "@/components/ai-accountant/shell";
import { ExportButtons, Money, NativeSelect, PeriodPicker, TableShell, istToday, qs, rupeesToPaiseInput, td, th, usePeriod } from "@/components/ai-accountant/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPaise, titleCase } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";

type Account = { id: string; code: string; name: string; type: string };
type JournalLine = { id: string; debit_paise: number; credit_paise: number; party: string | null; ledger_accounts: { code: string; name: string } | null };
type Entry = { id: string; entry_number: number; entry_date: string; memo: string | null; source_type: string | null; reversal_of: string | null; journal_lines: JournalLine[] };
type Journal = { entries: Entry[]; total: number; page: number; pageSize: number };
type Trial = { accounts: Array<{ code: string; name: string; type: string; debitPaise: number; creditPaise: number }>; debitPaise: number; creditPaise: number; balanced: boolean };

function ManualEntryDialog({ open, onOpenChange, accounts }: { open: boolean; onOpenChange: (open: boolean) => void; accounts: Account[] }) {
  const client = useQueryClient();
  const blank = { accountCode: "", debit: "", credit: "" };
  const [entryDate, setEntryDate] = useState(istToday());
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState([blank, blank]);
  const totals = lines.reduce(
    (acc, line) => ({ debit: acc.debit + (rupeesToPaiseInput(line.debit) ?? 0), credit: acc.credit + (rupeesToPaiseInput(line.credit) ?? 0) }),
    { debit: 0, credit: 0 }
  );
  const save = useMutation({
    mutationFn: () =>
      api("/api/v1/ai-accountant/journal", {
        method: "POST",
        body: JSON.stringify({
          entryDate,
          memo,
          lines: lines
            .filter((line) => line.accountCode)
            .map((line) => ({ accountCode: line.accountCode, debitPaise: rupeesToPaiseInput(line.debit) ?? 0, creditPaise: rupeesToPaiseInput(line.credit) ?? 0 })),
        }),
      }),
    onSuccess: () => {
      toast.success("Journal entry posted.");
      client.invalidateQueries({ queryKey: ["ai-accountant"] });
      onOpenChange(false);
      setMemo("");
      setLines([blank, blank]);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const update = (index: number, patch: Partial<typeof blank>) => setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manual journal entry</DialogTitle>
          <DialogDescription>For opening balances, owner capital and adjustments. Debits must equal credits.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <div className="space-y-1">
            <Label htmlFor="je-date">Date</Label>
            <Input id="je-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="je-memo">Description</Label>
            <Input id="je-memo" value={memo} maxLength={240} onChange={(e) => setMemo(e.target.value)} placeholder="Opening balance as on 1 April" />
          </div>
        </div>
        <div className="space-y-2">
          {lines.map((line, index) => (
            <div key={index} className="grid grid-cols-[1fr_110px_110px_36px] gap-2">
              <NativeSelect aria-label="Account" value={line.accountCode} onChange={(e) => update(index, { accountCode: e.target.value })}>
                <option value="">Choose account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.code}>
                    {account.code} · {account.name}
                  </option>
                ))}
              </NativeSelect>
              <Input aria-label="Debit" inputMode="decimal" placeholder="Debit ₹" value={line.debit} onChange={(e) => update(index, { debit: e.target.value, credit: e.target.value ? "" : line.credit })} />
              <Input aria-label="Credit" inputMode="decimal" placeholder="Credit ₹" value={line.credit} onChange={(e) => update(index, { credit: e.target.value, debit: e.target.value ? "" : line.debit })} />
              <Button size="icon-xs" variant="ghost" aria-label="Remove line" disabled={lines.length <= 2} onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button size="xs" variant="ghost" onClick={() => setLines((prev) => [...prev, blank])}>
            <Plus className="size-3.5" /> Add line
          </Button>
        </div>
        <p className={cn("text-sm", totals.debit === totals.credit && totals.debit > 0 ? "text-emerald-600" : "text-muted")}>
          Debits {formatPaise(totals.debit)} · Credits {formatPaise(totals.credit)}
        </p>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !memo || totals.debit !== totals.credit || totals.debit === 0} onClick={() => save.mutate()}>
            Post entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function LedgerPage() {
  const readOnly = useReadOnly();
  const client = useQueryClient();
  const { period, setPeriod } = usePeriod("this_month");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"journal" | "trial">("journal");
  const [open, setOpen] = useState(false);
  const accounts = useQuery({ queryKey: ["ai-accountant", "accounts"], queryFn: () => api<{ accounts: Account[] }>("/api/v1/ai-accountant/accounts") });
  const journal = useQuery({
    queryKey: ["ai-accountant", "journal", period.from, period.to, page],
    queryFn: () => api<Journal>(`/api/v1/ai-accountant/journal${qs({ ...period, page, pageSize: 50 })}`),
    enabled: view === "journal",
  });
  const trial = useQuery({
    queryKey: ["ai-accountant", "trial", period.from, period.to],
    queryFn: () => api<Trial>(`/api/v1/ai-accountant/reports/trial-balance${qs(period)}`),
    enabled: view === "trial",
  });
  const reverse = useMutation({
    mutationFn: (id: string) => api(`/api/v1/ai-accountant/journal/${id}/reverse`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      toast.success("Reversal posted.");
      client.invalidateQueries({ queryKey: ["ai-accountant"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const pages = journal.data ? Math.max(1, Math.ceil(journal.data.total / journal.data.pageSize)) : 1;

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>{view === "journal" ? "Journal" : "Trial balance"}</CardTitle>
            <CardDescription>Posted entries are never edited. Corrections are reversals.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setView(view === "journal" ? "trial" : "journal")}>
              {view === "journal" ? "Trial balance" : "Journal"}
            </Button>
            <ExportButtons kind={view === "journal" ? "JOURNAL" : "TRIAL_BALANCE"} period={period} />
            {view === "journal" ? <ExportButtons kind="TALLY" period={period} formats={["XML"]} /> : null}
            <Button size="sm" disabled={readOnly} onClick={() => setOpen(true)}>
              <Plus className="size-4" /> Manual entry
            </Button>
          </div>
        </div>
        <PeriodPicker value={period} onChange={(p) => (setPeriod(p), setPage(1))} />
      </CardHeader>
      <CardContent className="space-y-3">
        {view === "journal" ? (
          <>
            <TableShell>
              <thead>
                <tr>
                  <th className={th}>#</th>
                  <th className={th}>Date</th>
                  <th className={th}>Account</th>
                  <th className={cn(th, "text-right")}>Debit</th>
                  <th className={cn(th, "text-right")}>Credit</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {(journal.data?.entries ?? []).map((entry) => (
                  <Fragment key={entry.id}>
                    <tr>
                      <td className={cn(td, "text-xs text-muted")}>{entry.entry_number}</td>
                      <td className={cn(td, "whitespace-nowrap")}>{entry.entry_date}</td>
                      <td className={cn(td, "font-medium text-ink")} colSpan={3}>
                        {entry.memo}
                        <span className="ml-2 text-xs font-normal text-muted">{titleCase(entry.source_type ?? "")}</span>
                      </td>
                      <td className={cn(td, "text-right")}>
                        {entry.source_type !== "reversal" ? (
                          <Button size="icon-xs" variant="ghost" aria-label="Reverse entry" title="Reverse entry" disabled={readOnly || reverse.isPending} onClick={() => confirm("Post a reversing entry?") && reverse.mutate(entry.id)}>
                            <Undo2 className="size-4" />
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                    {entry.journal_lines.map((line) => (
                      <tr key={line.id} className="text-muted">
                        <td className="px-3 py-1" />
                        <td className="px-3 py-1" />
                        <td className={cn("px-3 py-1", line.credit_paise > 0 && "pl-8")}>
                          {line.ledger_accounts?.name}
                          {line.party ? <span className="ml-1 text-xs">· {line.party}</span> : null}
                        </td>
                        <td className="px-3 py-1 text-right">{line.debit_paise ? <Money paise={line.debit_paise} /> : null}</td>
                        <td className="px-3 py-1 text-right">{line.credit_paise ? <Money paise={line.credit_paise} /> : null}</td>
                        <td />
                      </tr>
                    ))}
                  </Fragment>
                ))}
                {journal.data && !journal.data.entries.length ? (
                  <tr>
                    <td colSpan={6} className={cn(td, "py-10 text-center text-muted")}>
                      No entries in this period. Use Sync ledger on the overview.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </TableShell>
            {pages > 1 ? (
              <div className="flex items-center justify-end gap-2 text-sm">
                <Button size="xs" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <span className="text-muted">
                  Page {page} of {pages}
                </span>
                <Button size="xs" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <TableShell>
            <thead>
              <tr>
                <th className={th}>Code</th>
                <th className={th}>Account</th>
                <th className={th}>Type</th>
                <th className={cn(th, "text-right")}>Debit</th>
                <th className={cn(th, "text-right")}>Credit</th>
              </tr>
            </thead>
            <tbody>
              {(trial.data?.accounts ?? []).map((row) => (
                <tr key={row.code}>
                  <td className={cn(td, "text-xs text-muted")}>{row.code}</td>
                  <td className={td}>{row.name}</td>
                  <td className={cn(td, "text-xs text-muted")}>{titleCase(row.type)}</td>
                  <td className={cn(td, "text-right")}>{row.debitPaise ? <Money paise={row.debitPaise} /> : null}</td>
                  <td className={cn(td, "text-right")}>{row.creditPaise ? <Money paise={row.creditPaise} /> : null}</td>
                </tr>
              ))}
              {trial.data ? (
                <tr>
                  <td className={cn(td, "font-semibold")} colSpan={3}>
                    Total {trial.data.balanced ? "" : "(does not balance)"}
                  </td>
                  <td className={cn(td, "text-right font-semibold")}>
                    <Money paise={trial.data.debitPaise} />
                  </td>
                  <td className={cn(td, "text-right font-semibold")}>
                    <Money paise={trial.data.creditPaise} />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </TableShell>
        )}
      </CardContent>
      <ManualEntryDialog open={open} onOpenChange={setOpen} accounts={accounts.data?.accounts ?? []} />
    </Card>
  );
}
